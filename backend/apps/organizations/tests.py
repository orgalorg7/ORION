from django.test import TestCase

from apps.deals.models import Pipeline

from .services import register_account


class LocalizedAccountDefaultsTests(TestCase):
    def register(self, language):
        return register_account(
            email=f'{language}@example.com',
            password='StrongPass123!',
            first_name='Test',
            organization_name=f'{language} organization',
            language=language,
        )

    def test_arabic_registration_creates_localized_system_pipeline(self):
        _, organization = self.register('ar')
        pipeline = Pipeline.objects.get(organization=organization, is_default=True)

        self.assertEqual(pipeline.name, 'مسار المبيعات')
        self.assertEqual(
            list(pipeline.stages.order_by('order').values_list('name', flat=True)),
            ['التأهيل', 'الاجتماع', 'العرض', 'التفاوض', 'الإغلاق'],
        )

    def test_english_registration_keeps_english_system_pipeline(self):
        _, organization = self.register('en')
        pipeline = Pipeline.objects.get(organization=organization, is_default=True)

        self.assertEqual(pipeline.name, 'Sales Pipeline')
        self.assertEqual(
            list(pipeline.stages.order_by('order').values_list('name', flat=True)),
            ['Qualification', 'Meeting', 'Proposal', 'Negotiation', 'Closing'],
        )
