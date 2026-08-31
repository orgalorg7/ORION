from datetime import time

from django.db import migrations


def seed_activity_configuration(apps, schema_editor):
    Organization = apps.get_model('organizations', 'Organization')
    ObjectTypeDefinition = apps.get_model('customer_core', 'ObjectTypeDefinition')
    Outcome = apps.get_model('activities', 'ActivityOutcomeDefinition')
    BusinessHours = apps.get_model('activities', 'BusinessHoursPolicy')
    outcomes = {
        'call': (
            ('connected', 'Connected'), ('no_answer', 'No Answer'), ('busy', 'Busy'),
            ('voicemail', 'Voicemail'), ('wrong_number', 'Wrong Number'),
            ('rescheduled', 'Rescheduled'), ('qualified', 'Qualified'),
            ('not_interested', 'Not Interested'),
        ),
        'meeting': (
            ('successful', 'Successful'), ('rescheduled', 'Rescheduled'),
            ('no_show', 'No Show'), ('cancelled', 'Cancelled'),
            ('needs_follow_up', 'Needs Follow-up'), ('proposal_requested', 'Proposal Requested'),
        ),
    }
    for organization in Organization.objects.all().iterator():
        ObjectTypeDefinition.objects.get_or_create(
            organization=organization, key='activity',
            defaults={'label': 'Activity', 'system': True, 'active': True},
        )
        for category, values in outcomes.items():
            for order, (key, label) in enumerate(values):
                Outcome.objects.get_or_create(
                    organization=organization, category=category, key=key,
                    defaults={'label': label, 'display_order': order},
                )
        BusinessHours.objects.get_or_create(
            organization=organization, is_default=True,
            defaults={
                'name': 'Standard business hours', 'timezone': 'UTC',
                'workdays': [0, 1, 2, 3, 4], 'opens_at': time(9), 'closes_at': time(17),
            },
        )


class Migration(migrations.Migration):
    dependencies = [
        ('activities', '0003_activityreminder_businessholiday_businesshourspolicy_and_more'),
        ('customer_core', '0007_alter_importjob_target_object'),
        ('organizations', '0001_initial'),
    ]

    operations = [migrations.RunPython(seed_activity_configuration, migrations.RunPython.noop)]
