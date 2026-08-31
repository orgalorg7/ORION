from django.db import migrations


def populate_normalized_identity(apps, schema_editor):
    from apps.core.normalization import normalize_email, normalize_name, normalize_phone

    Lead = apps.get_model('leads', 'Lead')
    for lead in Lead.objects.all().iterator():
        lead.display_name = f'{lead.first_name} {lead.last_name}'.strip()
        lead.normalized_name = normalize_name(lead.display_name)
        try:
            lead.normalized_email = normalize_email(lead.email)
        except Exception:
            lead.normalized_email = ''
        try:
            lead.normalized_phone = normalize_phone(lead.phone, lead.country)
        except Exception:
            lead.normalized_phone = ''
        lead.save(update_fields=['display_name', 'normalized_name', 'normalized_email', 'normalized_phone'])


class Migration(migrations.Migration):
    dependencies = [('leads', '0002_alter_lead_options_lead_address_lead_archived_at_and_more')]
    operations = [migrations.RunPython(populate_normalized_identity, migrations.RunPython.noop)]
