from decimal import Decimal

from .models import LeadScoringRule


DEFAULT_RULES = (
    ('email_present', 'Email present', {'field': 'email', 'operator': 'present'}, 5),
    ('phone_present', 'Phone present', {'field': 'phone', 'operator': 'present'}, 5),
    ('company_known', 'Company known', {'field': 'company', 'operator': 'present'}, 10),
    ('referral_source', 'Referral source', {'field': 'source', 'operator': 'equals', 'value': 'referral'}, 15),
    ('high_value', 'High estimated value', {'field': 'estimated_value', 'operator': 'gte', 'value': '10000'}, 20),
)


def seed_scoring_rules(organization, actor=None):
    for order, (code, label, condition, points) in enumerate(DEFAULT_RULES):
        LeadScoringRule.objects.get_or_create(
            organization=organization,
            code=code,
            defaults={
                'created_by': actor,
                'updated_by': actor,
                'label': label,
                'condition': condition,
                'points': points,
                'display_order': order,
            },
        )


class LeadScoringService:
    @staticmethod
    def rules_for(organization, actor=None):
        rules = list(LeadScoringRule.objects.filter(organization=organization, active=True))
        if not rules:
            seed_scoring_rules(organization, actor)
            rules = list(LeadScoringRule.objects.filter(organization=organization, active=True))
        return rules

    @staticmethod
    def calculate(lead, rules=None):
        rules = rules if rules is not None else LeadScoringService.rules_for(lead.organization, lead.created_by)
        reasons = []
        score = 0
        for rule in rules:
            condition = rule.condition or {}
            value = getattr(lead, condition.get('field', ''), None)
            if rule.code == 'company_known':
                value = lead.company_id or lead.company_name
            operator = condition.get('operator')
            matched = False
            if operator == 'present':
                matched = bool(value)
            elif operator == 'equals':
                matched = str(value or '').casefold() == str(condition.get('value', '')).casefold()
            elif operator == 'gte':
                try:
                    matched = value is not None and Decimal(str(value)) >= Decimal(str(condition.get('value')))
                except Exception:
                    matched = False
            if matched:
                score += rule.points
                reasons.append({'rule': rule.code.upper(), 'points': rule.points})
        return {'score': max(score, 0), 'reasons': reasons, 'components': {'behavioral': 0, 'predictive': 0, 'ai': 0}}
