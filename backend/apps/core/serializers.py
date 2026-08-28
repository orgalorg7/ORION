from django.contrib.auth import get_user_model
from rest_framework import serializers


class UserBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = get_user_model()
        fields = ['id', 'email', 'first_name', 'last_name']
        read_only_fields = fields
