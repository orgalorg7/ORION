from django.contrib.auth.models import AbstractUser
from django.db import models

from .managers import UserManager


class User(AbstractUser):
    class Language(models.TextChoices):
        ENGLISH = 'en', 'English'
        ARABIC = 'ar', 'Arabic'

    username = None
    email = models.EmailField('email address', unique=True)
    phone = models.CharField(max_length=50, blank=True)
    language = models.CharField(max_length=5, choices=Language.choices, default=Language.ENGLISH)

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = []

    objects = UserManager()

    def __str__(self):
        return self.email

    @property
    def full_name(self):
        return f'{self.first_name} {self.last_name}'.strip() or self.email
