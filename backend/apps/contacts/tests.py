from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.organizations.services import register_account

from .models import Contact, Tag


class ContactApiTests(APITestCase):
    def setUp(self):
        self.user_a, self.org_a = register_account(
            email='a@example.com', password='StrongPass123!', first_name='Alice', organization_name='Org A'
        )
        self.user_b, self.org_b = register_account(
            email='b@example.com', password='StrongPass123!', first_name='Bob', organization_name='Org B'
        )

    def test_create_and_list_contact(self):
        self.client.force_authenticate(self.user_a)
        response = self.client.post(
            '/api/v1/contacts/',
            {'first_name': 'Sara', 'last_name': 'Ahmed', 'email': 'sara@example.com'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(Contact.objects.filter(organization=self.org_a).count(), 1)

        response = self.client.get('/api/v1/contacts/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 1)

    def test_tenant_isolation(self):
        Contact.objects.create(organization=self.org_a, first_name='Private', created_by=self.user_a)
        self.client.force_authenticate(self.user_b)
        response = self.client.get('/api/v1/contacts/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 0)

    def test_cannot_link_other_org_tag(self):
        foreign_tag = Tag.objects.create(organization=self.org_b, name='VIP')
        self.client.force_authenticate(self.user_a)
        response = self.client.post(
            '/api/v1/contacts/',
            {'first_name': 'Sara', 'tags': [foreign_tag.id]},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_unauthenticated_rejected(self):
        response = self.client.get('/api/v1/contacts/')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
