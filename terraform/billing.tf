# What this costs, watched.
#
# The one gap where the worst case has no ceiling. Everything else that can go
# wrong here is bounded by what the site does; a runaway bill is not.
#
# Two things about this are easy to get wrong and both fail silently:
#
#   1. `AWS/Billing` metrics are published in **us-east-1 only**, whatever region
#      the account works in — the same shape as the CloudFront certificate rule.
#      An alarm created in eu-north-1 finds no metric and sits in
#      INSUFFICIENT_DATA forever, which on a dashboard looks a great deal like
#      "fine".
#
#   2. AWS does not publish the metric at all until "Receive Billing Alerts" is
#      switched on in Billing Preferences. That is a console setting on the
#      account, not something Terraform can set, and until it is done this alarm
#      is decoration. See docs/checklist-2026-09-06.md.
#
# A budget would be better — it forecasts rather than reacting to spend already
# incurred — but the deploy identity holds no `budgets:*` at all. A metric alarm
# needs no permission it does not already have, and something imperfect that
# exists beats something correct that does not.

variable "billing_alert_email" {
  description = <<-TEXT
    Where a spend alarm is sent. Empty disables the topic and the alarms entirely,
    so a checkout without it still applies cleanly.

    Requires the IAM grant in docs/iam-billing-alarm.json — as of 2026-09-06 the
    deploy identity holds neither cloudwatch:PutMetricAlarm nor sns:CreateTopic,
    both confirmed by direct probe. Apply will fail with AccessDenied until that
    policy edit is made.

    SNS will not deliver until the confirmation email is clicked. An unconfirmed
    subscription is not an error anywhere — it simply never delivers, which is the
    worst way for an alarm to be broken.
  TEXT
  type        = string
  default     = ""
}

variable "billing_alert_thresholds" {
  description = <<-TEXT
    Dollar amounts to alarm at. More than one on purpose: a single threshold tells
    you once, and by the time a big one fires the money is spent. A low one that
    fires in a normal month is the point — it is how you learn what normal is.

    EstimatedCharges is cumulative across the calendar month and resets on the
    1st, so these are month-to-date totals rather than rates.
  TEXT
  type        = list(number)
  default     = [5, 20, 100]
}

locals {
  billing_enabled = var.billing_alert_email != ""
}

# In us-east-1 alongside the alarms: a topic in another region cannot be the
# action for an alarm here.
resource "aws_sns_topic" "billing" {
  count    = local.billing_enabled ? 1 : 0
  provider = aws.us_east_1
  name     = "mimawsi-billing"
}

resource "aws_sns_topic_subscription" "billing" {
  count     = local.billing_enabled ? 1 : 0
  provider  = aws.us_east_1
  topic_arn = aws_sns_topic.billing[0].arn
  protocol  = "email"
  endpoint  = var.billing_alert_email

  # Terraform cannot confirm this — a human clicks the link in the email. It is
  # created "pending confirmation" and stays that way until someone does, so this
  # resource existing is not evidence that anything would ever be delivered.
}

resource "aws_cloudwatch_metric_alarm" "billing" {
  for_each = local.billing_enabled ? toset([for t in var.billing_alert_thresholds : tostring(t)]) : toset([])

  provider   = aws.us_east_1
  alarm_name = "mimawsi-spend-over-${each.key}-usd"

  namespace   = "AWS/Billing"
  metric_name = "EstimatedCharges"
  dimensions  = { Currency = "USD" }

  comparison_operator = "GreaterThanThreshold"
  threshold           = tonumber(each.key)
  evaluation_periods  = 1

  # Six hours. The metric is only refreshed every few hours, so a shorter period
  # produces gaps rather than faster warning.
  period    = 21600
  statistic = "Maximum"

  alarm_description = "mimawsi month-to-date spend has passed ${each.key} USD. Cumulative, resets on the 1st."
  alarm_actions     = [aws_sns_topic.billing[0].arn]

  # Missing data is *not* treated as breaching. Billing metrics arrive slowly and
  # are absent early in the month; alarming on their absence would cry wolf on the
  # 1st of every month, and an alarm that is normally noisy is one nobody reads.
  treat_missing_data = "notBreaching"
}

output "billing_alarm" {
  description = "Whether spend alarms are configured, and the two caveats that matter."
  value = local.billing_enabled ? format(
    "alarms at %s USD -> %s (confirm the SNS email, and enable Receive Billing Alerts in the console)",
    join(", ", [for t in var.billing_alert_thresholds : tostring(t)]),
    var.billing_alert_email,
  ) : "disabled: set billing_alert_email in terraform.tfvars (needs docs/iam-billing-alarm.json first)"
}
