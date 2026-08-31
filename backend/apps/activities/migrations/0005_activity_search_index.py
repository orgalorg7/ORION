from django.db import migrations


def add_postgresql_search_index(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    schema_editor.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm')
    schema_editor.execute(
        'CREATE INDEX IF NOT EXISTS activity_title_trgm_idx '
        'ON activities_activity USING gin (title gin_trgm_ops)'
    )


def remove_postgresql_search_index(apps, schema_editor):
    if schema_editor.connection.vendor == 'postgresql':
        schema_editor.execute('DROP INDEX IF EXISTS activity_title_trgm_idx')


class Migration(migrations.Migration):
    dependencies = [('activities', '0004_seed_activity_configuration')]

    operations = [migrations.RunPython(add_postgresql_search_index, remove_postgresql_search_index)]
