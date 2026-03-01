def calculate_late_fee(balance: float, monthly_percentage: float, days_late: int, grace_days: int = 0) -> float:
    """Placeholder business rule for late-fee estimation."""
    if balance <= 0 or monthly_percentage <= 0:
        return 0.0
    if days_late <= grace_days:
        return 0.0

    effective_days = max(days_late - grace_days, 0)
    daily_rate = (monthly_percentage / 100) / 30
    return round(balance * daily_rate * effective_days, 2)
