import time

from django.core.management.base import BaseCommand

from apps.activities.services import dispatch_due_reminders, generate_due_recurrences


class Command(BaseCommand):
    help = 'Process database-claimed activity reminders and recurrence windows.'

    def add_arguments(self, parser):
        parser.add_argument('--once', action='store_true', help='Run one bounded batch and exit.')
        parser.add_argument('--poll-seconds', type=int, default=30)
        parser.add_argument('--batch-size', type=int, default=100)

    def handle(self, *args, **options):
        poll_seconds = min(max(options['poll_seconds'], 5), 300)
        while True:
            reminders = dispatch_due_reminders(batch_size=options['batch_size'])
            recurrence = generate_due_recurrences(batch_size=min(options['batch_size'], 50))
            if any(reminders.values()) or any(recurrence.values()):
                self.stdout.write(f'reminders={reminders} recurrence={recurrence}')
            if options['once']:
                return
            time.sleep(poll_seconds)
