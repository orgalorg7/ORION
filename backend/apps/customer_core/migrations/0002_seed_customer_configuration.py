from django.db import migrations


SOURCES = [
    ('manual', 'Manual'), ('website', 'Website'), ('facebook', 'Facebook'),
    ('instagram', 'Instagram'), ('whatsapp', 'WhatsApp'), ('linkedin', 'LinkedIn'),
    ('google_ads', 'Google Ads'), ('referral', 'Referral'), ('import', 'Import'),
    ('api', 'API'), ('partner', 'Partner'), ('event', 'Event'), ('other', 'Other'),
]
RULES = [
    ('email_present', 'Email present', {'field': 'email', 'operator': 'present'}, 5),
    ('phone_present', 'Phone present', {'field': 'phone', 'operator': 'present'}, 5),
    ('company_known', 'Company known', {'field': 'company', 'operator': 'present'}, 10),
    ('referral_source', 'Referral source', {'field': 'source', 'operator': 'equals', 'value': 'referral'}, 15),
    ('high_value', 'High estimated value', {'field': 'estimated_value', 'operator': 'gte', 'value': '10000'}, 20),
]


def seed(apps, schema_editor):
    Organization = apps.get_model('organizations', 'Organization')
    LeadSource = apps.get_model('customer_core', 'LeadSource')
    LeadScoringRule = apps.get_model('customer_core', 'LeadScoringRule')
    for organization in Organization.objects.all().iterator():
        for order, (key, label) in enumerate(SOURCES):
            LeadSource.objects.get_or_create(
                organization=organization,
                key=key,
                defaults={'system_key': key, 'label': label, 'display_order': order},
            )
        for order, (code, label, condition, points) in enumerate(RULES):
            LeadScoringRule.objects.get_or_create(
                organization=organization,
                code=code,
                defaults={
                    'label': label, 'condition': condition, 'points': points, 'display_order': order,
                },
            )


class Migration(migrations.Migration):
    dependencies = [('customer_core', '0001_initial')]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
