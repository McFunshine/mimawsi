# __generated__ by Terraform
# Please review these resources and move them into your main configuration files.

# __generated__ by Terraform
resource "aws_iam_openid_connect_provider" "github" {
  client_id_list  = ["sts.amazonaws.com"]
  tags            = {}
  tags_all        = {}
  thumbprint_list = ["ab9d0263244dd0326eb67015705a667e79cfe998"]
  url = "https://token.actions.githubusercontent.com"
}

# adopted from an existing resource
resource "aws_iam_role" "github_deploy" {
  assume_role_policy    = "{\"Statement\":[{\"Action\":\"sts:AssumeRoleWithWebIdentity\",\"Condition\":{\"StringEquals\":{\"token.actions.githubusercontent.com:aud\":\"sts.amazonaws.com\",\"token.actions.githubusercontent.com:sub\":\"repo:McFunshine@181626727/mimawsi@1342919299:ref:refs/heads/main\"}},\"Effect\":\"Allow\",\"Principal\":{\"Federated\":\"arn:aws:iam::${var.account_id}:oidc-provider/token.actions.githubusercontent.com\"}}],\"Version\":\"2012-10-17\"}"
  description           = null
  force_detach_policies = false
  max_session_duration  = 3600
  name                  = "mimawsi-github-deploy"
  name_prefix           = null
  path                  = "/"
  permissions_boundary  = null
  tags                  = {}
  tags_all              = {}
}
