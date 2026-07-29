# Shared values referenced from more than one resource file.

locals {
  worker_timeout_seconds = 120
  worker_memory_mb       = 2048

  # M3: the Anthropic API key. Created out of band with
  #   aws ssm put-parameter --name /a11y-auditor/anthropic-api-key \
  #     --type SecureString --value "sk-ant-..."
  # and deliberately NOT managed by Terraform — an aws_ssm_parameter
  # resource (or a data source reading it) would write the plaintext key
  # into terraform.tfstate, which lives in S3. Terraform only ever knows
  # the name; the worker resolves the value at runtime.
  anthropic_param_name = "/a11y-auditor/anthropic-api-key"
}
