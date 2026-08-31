from django.db import migrations


SEARCH_INDEXES = (
    ('deal_title_trgm_idx', 'deals_deal', 'normalized_title'),
    ('deal_line_name_trgm_idx', 'deals_deallineitem', 'name_snapshot'),
    ('deal_product_name_trgm_idx', 'deals_product', 'name'),
    ('deal_company_name_trgm_idx', 'contacts_company', 'normalized_name'),
    ('deal_contact_name_trgm_idx', 'contacts_contact', 'normalized_name'),
)


def add_postgresql_search_indexes(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    schema_editor.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm')
    for name, table, column in SEARCH_INDEXES:
        schema_editor.execute(
            f'CREATE INDEX IF NOT EXISTS {name} ON {table} USING gin ({column} gin_trgm_ops)'
        )


def remove_postgresql_search_indexes(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    for name, _table, _column in SEARCH_INDEXES:
        schema_editor.execute(f'DROP INDEX IF EXISTS {name}')


class Migration(migrations.Migration):
    dependencies = [
        ('deals', '0007_deal_abandoned_at'),
    ]

    operations = [
        migrations.RunPython(add_postgresql_search_indexes, remove_postgresql_search_indexes),
    ]
