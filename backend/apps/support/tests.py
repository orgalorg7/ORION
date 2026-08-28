from rest_framework import status
from rest_framework.test import APITestCase

from apps.contacts.models import Contact
from apps.organizations.services import register_account

from .models import Ticket, TicketComment


class TicketApiTests(APITestCase):
    def setUp(self):
        self.user_a, self.org_a = register_account(
            email='a@example.com', password='StrongPass123!', first_name='Alice', organization_name='Org A'
        )
        self.user_b, self.org_b = register_account(
            email='b@example.com', password='StrongPass123!', first_name='Bob', organization_name='Org B'
        )

    def test_create_and_list_ticket(self):
        self.client.force_authenticate(self.user_a)
        response = self.client.post(
            '/api/v1/tickets/',
            {'subject': 'Cannot log in', 'description': 'Password reset fails', 'priority': 'high'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data['number'], 1)
        self.assertEqual(response.data['comments_count'], 0)
        self.assertEqual(Ticket.objects.filter(organization=self.org_a).count(), 1)

        response = self.client.get('/api/v1/tickets/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 1)

    def test_numbers_auto_increment_per_org(self):
        self.client.force_authenticate(self.user_a)
        first = self.client.post('/api/v1/tickets/', {'subject': 'First'}, format='json')
        second = self.client.post('/api/v1/tickets/', {'subject': 'Second'}, format='json')
        self.assertEqual(first.data['number'], 1)
        self.assertEqual(second.data['number'], 2)

        self.client.force_authenticate(self.user_b)
        other = self.client.post('/api/v1/tickets/', {'subject': 'Other org first'}, format='json')
        self.assertEqual(other.status_code, status.HTTP_201_CREATED, other.data)
        self.assertEqual(other.data['number'], 1)

    def test_tenant_isolation(self):
        ticket = Ticket.objects.create(organization=self.org_a, subject='Private', created_by=self.user_a)
        self.client.force_authenticate(self.user_b)
        response = self.client.get('/api/v1/tickets/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 0)

        response = self.client.get(f'/api/v1/tickets/{ticket.id}/')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_cannot_link_other_org_contact(self):
        foreign_contact = Contact.objects.create(organization=self.org_b, first_name='Foreign')
        self.client.force_authenticate(self.user_a)
        response = self.client.post(
            '/api/v1/tickets/',
            {'subject': 'Bad link', 'contact': foreign_contact.id},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_comments_get_and_post(self):
        ticket = Ticket.objects.create(organization=self.org_a, subject='Needs help', created_by=self.user_a)
        self.client.force_authenticate(self.user_a)

        response = self.client.post(
            f'/api/v1/tickets/{ticket.id}/comments/',
            {'body': 'Looking into it', 'is_internal': True},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data['body'], 'Looking into it')
        self.assertTrue(response.data['is_internal'])
        self.assertEqual(response.data['author'], self.user_a.id)
        self.assertEqual(response.data['author_detail']['email'], 'a@example.com')
        self.assertEqual(TicketComment.objects.filter(ticket=ticket).count(), 1)

        self.client.post(f'/api/v1/tickets/{ticket.id}/comments/', {'body': 'Fixed now'}, format='json')

        response = self.client.get(f'/api/v1/tickets/{ticket.id}/comments/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsInstance(response.data, list)
        self.assertEqual(len(response.data), 2)
        self.assertEqual(response.data[0]['body'], 'Looking into it')
        self.assertEqual(response.data[1]['body'], 'Fixed now')

        response = self.client.get(f'/api/v1/tickets/{ticket.id}/')
        self.assertEqual(response.data['comments_count'], 2)

    def test_comments_isolated_by_org(self):
        ticket = Ticket.objects.create(organization=self.org_a, subject='Private', created_by=self.user_a)
        self.client.force_authenticate(self.user_b)
        response = self.client.get(f'/api/v1/tickets/{ticket.id}/comments/')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

        response = self.client.post(
            f'/api/v1/tickets/{ticket.id}/comments/', {'body': 'Intruder'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(TicketComment.objects.count(), 0)

    def test_unauthenticated_rejected(self):
        response = self.client.get('/api/v1/tickets/')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
