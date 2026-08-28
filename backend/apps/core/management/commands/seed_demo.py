"""Seed a demo organization with realistic CRM data.

Usage: python manage.py seed_demo
Login afterwards with demo@crm.com / demo1234
"""
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.accounts.models import User
from apps.activities.models import Activity, Note
from apps.contacts.models import Company, Contact, Tag
from apps.deals.models import Deal, Pipeline
from apps.hr.models import Department, Employee
from apps.leads.models import Lead
from apps.organizations.models import Membership
from apps.organizations.services import register_account
from apps.support.models import Ticket, TicketComment

DEMO_EMAIL = 'demo@crm.com'
DEMO_PASSWORD = 'demo1234'


class Command(BaseCommand):
    help = 'Create a demo organization full of sample CRM data.'

    def handle(self, *args, **options):
        if User.objects.filter(email=DEMO_EMAIL).exists():
            self.stdout.write(self.style.WARNING('Demo user already exists — nothing to do.'))
            self.stdout.write(f'Login: {DEMO_EMAIL} / {DEMO_PASSWORD}')
            return

        now = timezone.now()
        user, org = register_account(
            email=DEMO_EMAIL,
            password=DEMO_PASSWORD,
            first_name='Demo',
            last_name='Admin',
            organization_name='Acme Trading',
        )

        # A second teammate
        teammate = User.objects.create_user(
            email='sales@crm.com', password=DEMO_PASSWORD, first_name='Layla', last_name='Hassan'
        )
        Membership.objects.create(user=teammate, organization=org, role=Membership.Role.MANAGER)

        def tenant(model, **kwargs):
            return model.objects.create(organization=org, created_by=user, **kwargs)

        # Tags
        tag_vip = tenant(Tag, name='VIP', color='#f59e0b')
        tag_partner = tenant(Tag, name='Partner', color='#10b981')
        tenant(Tag, name='Newsletter', color='#6366f1')

        # Companies
        companies_data = [
            ('Nile Software', 'nilesoft.io', 'Technology', 'Cairo', 'Egypt', '250000'),
            ('Gulf Logistics', 'gulflog.com', 'Logistics', 'Dubai', 'UAE', '1200000'),
            ('Delta Foods', 'deltafoods.com', 'FMCG', 'Alexandria', 'Egypt', '800000'),
            ('Levant Media', 'levantmedia.tv', 'Media', 'Amman', 'Jordan', '150000'),
            ('Atlas Construction', 'atlasbuild.co', 'Construction', 'Riyadh', 'Saudi Arabia', '4200000'),
        ]
        companies = []
        for name, domain, industry, city, country, revenue in companies_data:
            companies.append(
                tenant(
                    Company,
                    name=name,
                    domain=domain,
                    industry=industry,
                    city=city,
                    country=country,
                    annual_revenue=Decimal(revenue),
                    owner=user,
                    size=Company.Size.SMALL,
                )
            )

        # Contacts
        contacts_data = [
            ('Omar', 'Khaled', 'omar@nilesoft.io', 'CTO', companies[0], 'website'),
            ('Sara', 'Mansour', 'sara@nilesoft.io', 'Procurement Lead', companies[0], 'referral'),
            ('Ahmed', 'Al-Rashid', 'ahmed@gulflog.com', 'Operations Director', companies[1], 'event'),
            ('Mona', 'Ibrahim', 'mona@deltafoods.com', 'CEO', companies[2], 'cold_call'),
            ('Karim', 'Haddad', 'karim@levantmedia.tv', 'Head of Partnerships', companies[3], 'social'),
            ('Fatima', 'Al-Otaibi', 'fatima@atlasbuild.co', 'CFO', companies[4], 'referral'),
            ('John', 'Peterson', 'john@freelance.dev', 'Consultant', None, 'website'),
        ]
        contacts = []
        for first, last, email, title, company, source in contacts_data:
            contacts.append(
                tenant(
                    Contact,
                    first_name=first,
                    last_name=last,
                    email=email,
                    job_title=title,
                    company=company,
                    source=source,
                    owner=user,
                    phone='+20 100 555 0100',
                )
            )
        contacts[0].tags.add(tag_vip)
        contacts[3].tags.add(tag_vip, tag_partner)

        # Leads
        leads_data = [
            ('Nadia', 'Fares', 'nadia@horizonbank.com', 'Horizon Bank', 'new', 35, '45000'),
            ('Tarek', 'Salem', 'tarek@medicaplus.com', 'Medica Plus', 'contacted', 55, '18000'),
            ('Lina', 'Aziz', 'lina@stellartravel.co', 'Stellar Travel', 'qualified', 80, '32000'),
            ('Hassan', 'Nouri', 'hassan@oasisretail.com', 'Oasis Retail', 'new', 20, '9000'),
            ('Emily', 'Carter', 'emily@brightedu.org', 'Bright Education', 'unqualified', 10, None),
        ]
        for first, last, email, company_name, status, score, value in leads_data:
            tenant(
                Lead,
                first_name=first,
                last_name=last,
                email=email,
                company_name=company_name,
                status=status,
                score=score,
                estimated_value=Decimal(value) if value else None,
                source='website',
                owner=teammate if score > 50 else user,
            )

        # Deals across the default pipeline
        pipeline = Pipeline.objects.filter(organization=org, is_default=True).first()
        stages = list(pipeline.stages.order_by('order'))
        deals_data = [
            ('ERP implementation — Nile Software', '85000', 0, 'open', contacts[0], companies[0]),
            ('Fleet tracking rollout', '120000', 1, 'open', contacts[2], companies[1]),
            ('Annual supply contract', '64000', 2, 'open', contacts[3], companies[2]),
            ('Media production retainer', '36000', 3, 'open', contacts[4], companies[3]),
            ('HQ tower consultancy', '210000', 4, 'open', contacts[5], companies[4]),
            ('Website revamp', '15000', 2, 'won', contacts[1], companies[0]),
            ('Warehouse automation pilot', '48000', 3, 'won', contacts[2], companies[1]),
            ('Catering software license', '22000', 1, 'lost', contacts[3], companies[2]),
        ]
        for index, (title, value, stage_index, status, contact, company) in enumerate(deals_data):
            deal = tenant(
                Deal,
                title=title,
                value=Decimal(value),
                currency=org.currency,
                pipeline=pipeline,
                stage=stages[stage_index],
                contact=contact,
                company=company,
                owner=teammate if index % 2 else user,
                status=status,
                expected_close_date=(now + timedelta(days=14 + index * 9)).date(),
            )
            if status != 'open':
                deal.closed_at = now - timedelta(days=10 + index * 11)
                if status == 'lost':
                    deal.lost_reason = 'Chose a competitor'
                deal.save(update_fields=['closed_at', 'lost_reason'])

        # Spread the won deals across recent months so the revenue chart has shape
        won = list(Deal.objects.filter(organization=org, status='won'))
        for index, deal in enumerate(won):
            deal.closed_at = now - timedelta(days=20 + index * 40)
            deal.save(update_fields=['closed_at'])

        # Activities
        activities_data = [
            ('call', 'Discovery call with Omar', contacts[0], 1, False),
            ('meeting', 'Demo for Gulf Logistics ops team', contacts[2], 3, False),
            ('task', 'Send proposal to Delta Foods', contacts[3], 2, False),
            ('email', 'Follow up on retainer terms', contacts[4], -2, False),
            ('task', 'Prepare Q3 pipeline review', None, 5, False),
            ('call', 'Intro call with Fatima', contacts[5], -6, True),
        ]
        for type_, title, contact, day_offset, completed in activities_data:
            tenant(
                Activity,
                type=type_,
                title=title,
                contact=contact,
                due_at=now + timedelta(days=day_offset),
                completed=completed,
                completed_at=now - timedelta(days=1) if completed else None,
                assigned_to=user,
            )

        tenant(Note, body='Omar prefers technical deep-dives — bring an engineer to the next call.', contact=contacts[0], author=user)
        tenant(Note, body='Budget approval expected after their board meeting.', contact=contacts[3], author=teammate)

        # HR
        dept_sales = tenant(Department, name='Sales')
        dept_eng = tenant(Department, name='Engineering')
        dept_support = tenant(Department, name='Customer Support')
        manager = tenant(
            Employee,
            first_name='Layla',
            last_name='Hassan',
            email='sales@crm.com',
            department=dept_sales,
            job_title='Sales Manager',
            employment_type='full_time',
            status='active',
            hire_date=(now - timedelta(days=700)).date(),
            salary=Decimal('4500'),
            user=teammate,
            city='Cairo',
            country='Egypt',
        )
        employees_data = [
            ('Youssef', 'Adel', dept_sales, 'Account Executive', 'active', '2600'),
            ('Rana', 'Mostafa', dept_sales, 'SDR', 'active', '1800'),
            ('Amr', 'Fathy', dept_eng, 'Backend Engineer', 'active', '3800'),
            ('Dina', 'Sami', dept_eng, 'Frontend Engineer', 'on_leave', '3600'),
            ('Khaled', 'Omar', dept_support, 'Support Specialist', 'active', '1600'),
        ]
        for first, last, dept, title, status, salary in employees_data:
            tenant(
                Employee,
                first_name=first,
                last_name=last,
                email=f'{first.lower()}@acmetrading.com',
                department=dept,
                job_title=title,
                employment_type='full_time',
                status=status,
                hire_date=(now - timedelta(days=400)).date(),
                salary=Decimal(salary),
                manager=manager if dept == dept_sales else None,
                city='Cairo',
                country='Egypt',
            )

        # Tickets
        ticket1 = tenant(
            Ticket,
            subject='Cannot export contacts to CSV',
            description='Export button returns a 500 error since yesterday.',
            contact=contacts[0],
            status='open',
            priority='high',
            category='technical',
            assigned_to=user,
        )
        tenant(
            Ticket,
            subject='Invoice for August is missing',
            description='We did not receive the August invoice by email.',
            contact=contacts[3],
            status='in_progress',
            priority='medium',
            category='billing',
            assigned_to=teammate,
        )
        tenant(
            Ticket,
            subject='Feature request: WhatsApp integration',
            description='Sales team would like to log WhatsApp conversations.',
            contact=contacts[2],
            status='resolved',
            priority='low',
            category='feature_request',
            assigned_to=user,
        )
        TicketComment.objects.create(ticket=ticket1, author=user, body='Reproduced — escalating to engineering.')
        TicketComment.objects.create(ticket=ticket1, author=teammate, body='Fix scheduled for the next release.', is_internal=True)

        self.stdout.write(self.style.SUCCESS('Demo organization created.'))
        self.stdout.write(f'  Login:    {DEMO_EMAIL} / {DEMO_PASSWORD}')
        self.stdout.write(f'  Teammate: sales@crm.com / {DEMO_PASSWORD}')
