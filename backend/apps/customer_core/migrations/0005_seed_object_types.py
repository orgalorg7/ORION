from django.db import migrations


def seed(apps, schema_editor):
    Organization = apps.get_model('organizations', 'Organization')
    ObjectTypeDefinition = apps.get_model('customer_core', 'ObjectTypeDefinition')
    for organization in Organization.objects.all().iterator():
        for key, label in (('lead', 'Lead'), ('contact', 'Contact'), ('company', 'Company')):
            ObjectTypeDefinition.objects.get_or_create(
                organization=organization,
                key=key,
                defaults={'label': label, 'system': True},
            )


class Migration(migrations.Migration):
    dependencies = [('customer_core', '0004_alter_customfielddefinition_target_object_and_more')]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
