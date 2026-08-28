from datetime import timedelta

from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.contacts.models import Contact
from apps.organizations.services import register_account

from .models import Activity, Note


class ActivityApiTests(APITestCase):
    def setUp(self):
        self.user_a, self.org_a = register_account(
            email='a@example.com', password='StrongPass123!', first_name='Alice', organization_name='Org A'
        )
        self.user_b, self.org_b = register_account(
            email='b@example.com', password='StrongPass123!', first_name='Bob', organization_name='Org B'
        )

    def test_create_and_list_activity(self):
        self.client.force_authenticate(self.user_a)
        response = self.client.post(
            '/api/v1/activities/',
            {'type': 'call', 'title': 'Intro call'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(Activity.objects.filter(organization=self.org_a).count(), 1)

        response = self.client.get('/api/v1/activities/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['results'][0]['title'], 'Intro call')

    def test_tenant_isolation(self):
        activity = Activity.objects.create(organization=self.org_a, title='Private', created_by=self.user_a)
        self.client.force_authenticate(self.user_b)
        response = self.client.get('/api/v1/activities/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 0)

        response = self.client.post(f'/api/v1/activities/{activity.id}/complete/', {'completed': True}, format='json')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_complete_toggle(self):
        activity = Activity.objects.create(organization=self.org_a, title='Task', created_by=self.user_a)
        self.client.force_authenticate(self.user_a)

        response = self.client.post(f'/api/v1/activities/{activity.id}/complete/', {'completed': True}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertTrue(response.data['completed'])
        self.assertIsNotNone(response.data['completed_at'])
        activity.refresh_from_db()
        self.assertTrue(activity.completed)
        self.assertIsNotNone(activity.completed_at)

        response = self.client.post(f'/api/v1/activities/{activity.id}/complete/', {'completed': False}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertFalse(response.data['completed'])
        self.assertIsNone(response.data['completed_at'])
        activity.refresh_from_db()
        self.assertFalse(activity.completed)
        self.assertIsNone(activity.completed_at)

    def test_due_before_filter(self):
        now = timezone.now()
        Activity.objects.create(
            organization=self.org_a, title='Soon', due_at=now + timedelta(days=1), created_by=self.user_a
        )
        Activity.objects.create(
            organization=self.org_a, title='Later', due_at=now + timedelta(days=10), created_by=self.user_a
        )
        self.client.force_authenticate(self.user_a)
        response = self.client.get(
            '/api/v1/activities/', {'due_before': (now + timedelta(days=2)).isoformat()}
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['results'][0]['title'], 'Soon')

    def test_cannot_link_other_org_contact(self):
        foreign_contact = Contact.objects.create(organization=self.org_b, first_name='Foreign', created_by=self.user_b)
        self.client.force_authenticate(self.user_a)
        response = self.client.post(
            '/api/v1/activities/',
            {'title': 'Call', 'contact': foreign_contact.id},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class NoteApiTests(APITestCase):
    def setUp(self):
        self.user_a, self.org_a = register_account(
            email='a@example.com', password='StrongPass123!', first_name='Alice', organization_name='Org A'
        )
        self.user_b, self.org_b = register_account(
            email='b@example.com', password='StrongPass123!', first_name='Bob', organization_name='Org B'
        )

    def test_create_note_stamps_author(self):
        self.client.force_authenticate(self.user_a)
        response = self.client.post('/api/v1/notes/', {'body': 'Called them today.'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data['author'], self.user_a.id)
        self.assertEqual(response.data['author_detail']['email'], 'a@example.com')

        note = Note.objects.get()
        self.assertEqual(note.author, self.user_a)
        self.assertEqual(note.created_by, self.user_a)
        self.assertEqual(note.organization, self.org_a)

    def test_list_and_filter_by_contact(self):
        contact = Contact.objects.create(organization=self.org_a, first_name='Sara', created_by=self.user_a)
        Note.objects.create(organization=self.org_a, body='On contact', contact=contact, created_by=self.user_a)
        Note.objects.create(organization=self.org_a, body='Unlinked', created_by=self.user_a)

        self.client.force_authenticate(self.user_a)
        response = self.client.get('/api/v1/notes/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 2)

        response = self.client.get('/api/v1/notes/', {'contact': contact.id})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['results'][0]['body'], 'On contact')

    def test_tenant_isolation(self):
        Note.objects.create(organization=self.org_a, body='Private', created_by=self.user_a)
        self.client.force_authenticate(self.user_b)
        response = self.client.get('/api/v1/notes/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 0)
