from rest_framework import serializers

from apps.core.fields import OrgMemberPrimaryKeyRelatedField, TenantPrimaryKeyRelatedField
from apps.core.serializers import UserBriefSerializer

from .models import Department, Employee


class DepartmentBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = ['id', 'name']
        read_only_fields = fields


class DepartmentSerializer(serializers.ModelSerializer):
    employees_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Department
        fields = ['id', 'name', 'description', 'employees_count', 'created_at']
        read_only_fields = ['id', 'created_at']


class EmployeeBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Employee
        fields = ['id', 'first_name', 'last_name']
        read_only_fields = fields


class EmployeeSerializer(serializers.ModelSerializer):
    user = OrgMemberPrimaryKeyRelatedField(required=False, allow_null=True)
    user_detail = UserBriefSerializer(source='user', read_only=True)
    department = TenantPrimaryKeyRelatedField(
        queryset=Department.objects.all(), required=False, allow_null=True
    )
    department_detail = DepartmentBriefSerializer(source='department', read_only=True)
    manager = TenantPrimaryKeyRelatedField(
        queryset=Employee.objects.all(), required=False, allow_null=True
    )
    manager_detail = EmployeeBriefSerializer(source='manager', read_only=True)

    class Meta:
        model = Employee
        fields = [
            'id', 'first_name', 'last_name', 'email', 'phone',
            'user', 'user_detail', 'department', 'department_detail',
            'job_title', 'employment_type', 'status', 'hire_date', 'salary',
            'manager', 'manager_detail', 'city', 'country',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_manager(self, value):
        if value is not None and self.instance is not None and value.pk == self.instance.pk:
            raise serializers.ValidationError('An employee cannot be their own manager.')
        return value
