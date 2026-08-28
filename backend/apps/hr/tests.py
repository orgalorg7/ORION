from rest_framework import status
from rest_framework.test import APITestCase

from apps.organizations.services import register_account

from .models import Department, Employee


class DepartmentApiTests(APITestCase):
    def setUp(self):
        self.user_a, self.org_a = register_account(
            email='a@example.com', password='StrongPass123!', first_name='Alice', organization_name='Org A'
        )
        self.user_b, self.org_b = register_account(
            email='b@example.com', password='StrongPass123!', first_name='Bob', organization_name='Org B'
        )

    def test_create_and_list_department(self):
        self.client.force_authenticate(self.user_a)
        response = self.client.post(
            '/api/v1/departments/',
            {'name': 'Engineering', 'description': 'Builds things'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(Department.objects.filter(organization=self.org_a).count(), 1)

        response = self.client.get('/api/v1/departments/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # pagination is disabled: response is a plain array
        self.assertIsInstance(response.data, list)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['name'], 'Engineering')

    def test_employees_count_annotation(self):
        department = Department.objects.create(organization=self.org_a, name='Sales', created_by=self.user_a)
        Employee.objects.create(
            organization=self.org_a, first_name='Sara', department=department, created_by=self.user_a
        )
        Employee.objects.create(
            organization=self.org_a, first_name='Omar', department=department, created_by=self.user_a
        )
        Employee.objects.create(organization=self.org_a, first_name='NoDept', created_by=self.user_a)

        self.client.force_authenticate(self.user_a)
        response = self.client.get('/api/v1/departments/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data[0]['employees_count'], 2)

    def test_tenant_isolation(self):
        Department.objects.create(organization=self.org_a, name='Private', created_by=self.user_a)
        self.client.force_authenticate(self.user_b)
        response = self.client.get('/api/v1/departments/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 0)

    def test_unauthenticated_rejected(self):
        response = self.client.get('/api/v1/departments/')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class EmployeeApiTests(APITestCase):
    def setUp(self):
        self.user_a, self.org_a = register_account(
            email='a@example.com', password='StrongPass123!', first_name='Alice', organization_name='Org A'
        )
        self.user_b, self.org_b = register_account(
            email='b@example.com', password='StrongPass123!', first_name='Bob', organization_name='Org B'
        )

    def test_create_and_list_employee(self):
        department = Department.objects.create(organization=self.org_a, name='Engineering', created_by=self.user_a)
        self.client.force_authenticate(self.user_a)
        response = self.client.post(
            '/api/v1/employees/',
            {
                'first_name': 'Sara',
                'last_name': 'Ahmed',
                'email': 'sara@example.com',
                'department': department.id,
                'user': self.user_a.id,
                'job_title': 'Engineer',
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data['department_detail'], {'id': department.id, 'name': 'Engineering'})
        self.assertEqual(response.data['user_detail']['id'], self.user_a.id)
        self.assertEqual(Employee.objects.filter(organization=self.org_a).count(), 1)

        response = self.client.get('/api/v1/employees/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 1)

    def test_manager_detail_and_self_manager_rejected(self):
        manager = Employee.objects.create(
            organization=self.org_a, first_name='Mona', last_name='Boss', created_by=self.user_a
        )
        self.client.force_authenticate(self.user_a)
        response = self.client.post(
            '/api/v1/employees/',
            {'first_name': 'Sara', 'manager': manager.id},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(
            response.data['manager_detail'],
            {'id': manager.id, 'first_name': 'Mona', 'last_name': 'Boss'},
        )

        employee_id = response.data['id']
        response = self.client.patch(
            f'/api/v1/employees/{employee_id}/',
            {'manager': employee_id},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('manager', response.data)

    def test_filters(self):
        department = Department.objects.create(organization=self.org_a, name='Sales', created_by=self.user_a)
        Employee.objects.create(
            organization=self.org_a,
            first_name='Active',
            department=department,
            status=Employee.Status.ACTIVE,
            employment_type=Employee.EmploymentType.FULL_TIME,
            created_by=self.user_a,
        )
        Employee.objects.create(
            organization=self.org_a,
            first_name='Gone',
            status=Employee.Status.TERMINATED,
            employment_type=Employee.EmploymentType.CONTRACT,
            created_by=self.user_a,
        )

        self.client.force_authenticate(self.user_a)
        response = self.client.get('/api/v1/employees/', {'status': 'active'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['results'][0]['first_name'], 'Active')

        response = self.client.get('/api/v1/employees/', {'department': department.id})
        self.assertEqual(response.data['count'], 1)

        response = self.client.get('/api/v1/employees/', {'employment_type': 'contract'})
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['results'][0]['first_name'], 'Gone')

    def test_tenant_isolation(self):
        Employee.objects.create(organization=self.org_a, first_name='Private', created_by=self.user_a)
        self.client.force_authenticate(self.user_b)
        response = self.client.get('/api/v1/employees/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 0)

    def test_cannot_link_other_org_department_or_manager(self):
        foreign_department = Department.objects.create(
            organization=self.org_b, name='Foreign', created_by=self.user_b
        )
        foreign_manager = Employee.objects.create(
            organization=self.org_b, first_name='Outsider', created_by=self.user_b
        )
        self.client.force_authenticate(self.user_a)
        response = self.client.post(
            '/api/v1/employees/',
            {'first_name': 'Sara', 'department': foreign_department.id},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        response = self.client.post(
            '/api/v1/employees/',
            {'first_name': 'Sara', 'manager': foreign_manager.id},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cannot_link_non_member_user(self):
        self.client.force_authenticate(self.user_a)
        response = self.client.post(
            '/api/v1/employees/',
            {'first_name': 'Sara', 'user': self.user_b.id},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
