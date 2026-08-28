from django.db.models import Count

from apps.core.viewsets import TenantViewSet

from .models import Department, Employee
from .serializers import DepartmentSerializer, EmployeeSerializer


class DepartmentViewSet(TenantViewSet):
    queryset = Department.objects.all()
    serializer_class = DepartmentSerializer
    search_fields = ['name']
    pagination_class = None

    def get_queryset(self):
        return super().get_queryset().annotate(employees_count=Count('employees', distinct=True))


class EmployeeViewSet(TenantViewSet):
    queryset = Employee.objects.all()
    serializer_class = EmployeeSerializer
    filterset_fields = ['department', 'status', 'employment_type', 'manager']
    search_fields = ['first_name', 'last_name', 'email', 'job_title']
    ordering_fields = ['first_name', 'hire_date', 'created_at']

    def get_queryset(self):
        return super().get_queryset().select_related('department', 'manager', 'user')
