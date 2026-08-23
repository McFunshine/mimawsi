# Adopted from resources built by hand, generated from their live state rather
# than written from memory, then tidied so cross-references are references.
#
# Real account ids and bucket names are variables, not literals: this repository
# is public. Values live in terraform.tfvars, which is gitignored.

# __generated__ by Terraform
# Please review these resources and move them into your main configuration files.

# __generated__ by Terraform from aws_cloudfront_origin_access_control.site.id
resource "aws_cloudfront_origin_access_control" "site" {
  description                       = "OAC for mimawsi site bucket"
  name                              = "mimawsi-site-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# adopted from an existing distribution
resource "aws_cloudfront_response_headers_policy" "runner" {
  comment = "mimawsi runner: tool CSP + frame-ancestors. See infra/cloudfront."
  name    = "mimawsi-runner-headers"
  custom_headers_config {
    items {
      header   = "cache-control"
      override = true
      value    = "no-store"
    }
  }
  security_headers_config {
    content_security_policy {
      content_security_policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; frame-ancestors https://mimawsi.com https://www.mimawsi.com"
      override                = true
    }
    content_type_options {
      override = true
    }
    referrer_policy {
      override        = true
      referrer_policy = "no-referrer"
    }
  }
}

# adopted from an existing distribution
resource "aws_cloudfront_distribution" "runner" {
  aliases                         = []
  comment                         = "mimawsi runner origin: tools execute here, never on the catalogue origin (RULE-23)"
  continuous_deployment_policy_id = null
  default_root_object             = null
  enabled                         = true
  http_version                    = "http2"
  is_ipv6_enabled                 = true
  price_class                     = "PriceClass_100"
  retain_on_delete                = false
  staging                         = false
  tags                            = {}
  tags_all                        = {}
  wait_for_deployment             = true
  web_acl_id                      = null
  default_cache_behavior {
    allowed_methods            = ["GET", "HEAD"]
    cache_policy_id            = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    default_ttl                = 0
    field_level_encryption_id  = null
    max_ttl                    = 0
    min_ttl                    = 0
    origin_request_policy_id   = null
    realtime_log_config_arn    = null
    response_headers_policy_id = "f2bef598-e1e6-45a4-afb4-8ddd386d40f6"
    smooth_streaming           = false
    target_origin_id           = "s3-tools"
    trusted_key_groups         = []
    trusted_signers            = []
    viewer_protocol_policy     = "redirect-to-https"
    grpc_config {
      enabled = false
    }
  }
  origin {
    connection_attempts      = 3
    connection_timeout       = 10
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
    origin_id                = "s3-tools"
    origin_path              = "/tools"
  }
  restrictions {
    geo_restriction {
      locations        = []
      restriction_type = "none"
    }
  }
  viewer_certificate {
    acm_certificate_arn            = null
    cloudfront_default_certificate = true
    iam_certificate_id             = null
    minimum_protocol_version       = "TLSv1"
    ssl_support_method             = null
  }
}

# adopted from an existing distribution
resource "aws_cloudfront_distribution" "site" {
  aliases                         = ["mimawsi.com", "www.mimawsi.com"]
  comment                         = "mimawsi.com static site"
  continuous_deployment_policy_id = null
  default_root_object             = "index.html"
  enabled                         = true
  http_version                    = "http2and3"
  is_ipv6_enabled                 = true
  price_class                     = "PriceClass_100"
  retain_on_delete                = false
  staging                         = false
  tags                            = {}
  tags_all                        = {}
  wait_for_deployment             = true
  web_acl_id                      = null
  default_cache_behavior {
    allowed_methods            = ["GET", "HEAD"]
    cache_policy_id            = "658327ea-f89d-4fab-a63d-7e88639e58f6"
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    default_ttl                = 0
    field_level_encryption_id  = null
    max_ttl                    = 0
    min_ttl                    = 0
    origin_request_policy_id   = null
    realtime_log_config_arn    = null
    response_headers_policy_id = null
    smooth_streaming           = false
    target_origin_id           = "s3-site"
    trusted_key_groups         = []
    trusted_signers            = []
    viewer_protocol_policy     = "redirect-to-https"
    function_association {
      event_type   = "viewer-request"
      function_arn = "arn:aws:cloudfront::${var.account_id}:function/mimawsi-directory-index"
    }
    grpc_config {
      enabled = false
    }
  }
  origin {
    connection_attempts      = 3
    connection_timeout       = 10
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
    origin_id                = "s3-site"
    origin_path              = null
  }
  restrictions {
    geo_restriction {
      locations        = []
      restriction_type = "none"
    }
  }
  viewer_certificate {
    acm_certificate_arn            = "arn:aws:acm:us-east-1:${var.account_id}:certificate/a3418cde-c6e4-47a0-aabd-05e341ba799b"
    cloudfront_default_certificate = false
    iam_certificate_id             = null
    minimum_protocol_version       = "TLSv1.2_2021"
    ssl_support_method             = "sni-only"
  }
}

# __generated__ by Terraform from var.site_bucket
resource "aws_s3_bucket" "site" {
  bucket              = var.site_bucket
  bucket_prefix       = null
  force_destroy       = null
  object_lock_enabled = false
  tags                = {}
  tags_all            = {}
}
