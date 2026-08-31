from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('activities', '0005_activity_search_index')]

    operations = [
        migrations.AddIndex(
            model_name='activity',
            index=models.Index(
                fields=['organization', 'assigned_to', 'status', 'due_date'],
                name='act_org_owner_status_date_idx',
            ),
        ),
        migrations.AddIndex(
            model_name='activity',
            index=models.Index(
                fields=['organization', 'due_date', 'status'],
                name='act_org_date_status_idx',
            ),
        ),
        migrations.AddIndex(
            model_name='activity',
            index=models.Index(
                fields=['organization', 'sla_deadline_at', 'status'],
                name='act_org_sla_status_idx',
            ),
        ),
    ]
