from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('activities', '0006_activity_all_day_and_sla_indexes')]

    operations = [
        migrations.AddIndex(
            model_name='activityrecurrenceseries',
            index=models.Index(
                fields=['active', 'next_generation_at', 'id'],
                name='activity_series_due_idx',
            ),
        ),
    ]
