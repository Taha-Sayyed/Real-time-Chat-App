#Requires -Version 5.1
$ErrorActionPreference = "Stop"

# ==================== CONFIGURATION ====================
$REGION = "ap-south-1"
$ACCOUNT_ID = "930849665875"
$BUCKET_NAME = "chat-app-frontend-taha-1211"
$VPC_CIDR = "10.0.0.0/16"
$CLUSTER_NAME = "chat-app-cluster"
$NAMESPACE_NAME = "chat-app.local"

# Ports
$USER_PORT = 5000
$MAIL_PORT = 5001
$CHAT_PORT = 5002

# ECR Image URIs
$USER_IMAGE = "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/chat-app/user-service:latest"
$MAIL_IMAGE = "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/chat-app/mail-service:latest"
$CHAT_IMAGE = "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/chat-app/chat-service:latest"
$RABBITMQ_IMAGE = "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/chat-app/rabbitmq:latest"

# ==================== EDIT THESE PLACEHOLDERS ====================
$USER_MONGO_URI = "REPLACE_WITH_YOUR_MONGO_URI"
$USER_REDIS_URL = "REPLACE_WITH_YOUR_UPSTASH_REDIS_URL"
$USER_JWT_PRIVATE_KEY = "REPLACE_WITH_YOUR_BASE64_PRIVATE_KEY"
$USER_JWT_PUBLIC_KEY = "REPLACE_WITH_YOUR_BASE64_PUBLIC_KEY"

$MAIL_SMTP_USER = "REPLACE_WITH_YOUR_SMTP_USER"
$MAIL_SMTP_PASS = "REPLACE_WITH_YOUR_SMTP_PASS"

$CHAT_MONGO_URI = "REPLACE_WITH_YOUR_MONGO_URI"
$CHAT_JWT_PUBLIC_KEY = "REPLACE_WITH_YOUR_RSA_PUBLIC_KEY"
$CHAT_CLOUD_NAME = "REPLACE_WITH_CLOUDINARY_CLOUD_NAME"
$CHAT_API_KEY = "REPLACE_WITH_CLOUDINARY_API_KEY"
$CHAT_API_SECRET = "REPLACE_WITH_CLOUDINARY_API_SECRET"
# =================================================================

Write-Host "=========================================="
Write-Host "AWS Chat App Infrastructure Creation"
Write-Host "Region: $REGION"
Write-Host "=========================================="

# Validate prerequisites
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw "AWS CLI not found. Install it and run 'aws configure'."
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker not found. Install Docker Desktop and start it."
}

# Helper: Run AWS CLI and check exit code
function Invoke-Aws {
    param([string]$Command)
    Write-Host "  CMD: $Command"
    Invoke-Expression $Command
    if ($LASTEXITCODE -ne 0) {
        throw "AWS command failed: $Command"
    }
}

# Helper: Test if AWS resource exists (returns $true/$false, no error output)
function Test-AwsResource {
    param([string]$Command)
    Invoke-Expression $Command 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
}

# Get public IP for RabbitMQ SG
$USER_IP = (Invoke-RestMethod -Uri "https://checkip.amazonaws.com").Trim() + "/32"
Write-Host "Your public IP for RabbitMQ UI access: $USER_IP"

# ------------------- STEP 1: IAM ROLES -------------------
Write-Host "[1/15] Checking IAM Roles..."

$TRUST_POLICY = @"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {"Service": "ecs-tasks.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }
  ]
}
"@

if (-not (Test-AwsResource "aws iam get-role --role-name ecsTaskExecutionRole")) {
    Write-Host "  Creating ecsTaskExecutionRole..."
    Set-Content -Path "$env:TEMP/trust-policy.json" -Value $TRUST_POLICY
    Invoke-Aws "aws iam create-role --role-name ecsTaskExecutionRole --assume-role-policy-document file://$env:TEMP/trust-policy.json"
    Invoke-Aws "aws iam attach-role-policy --role-name ecsTaskExecutionRole --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
} else {
    Write-Host "  ecsTaskExecutionRole already exists"
}

if (-not (Test-AwsResource "aws iam get-role --role-name ecsTaskRole")) {
    Write-Host "  Creating ecsTaskRole..."
    Set-Content -Path "$env:TEMP/trust-policy.json" -Value $TRUST_POLICY
    Invoke-Aws "aws iam create-role --role-name ecsTaskRole --assume-role-policy-document file://$env:TEMP/trust-policy.json"
} else {
    Write-Host "  ecsTaskRole already exists"
}

# ------------------- STEP 2: VPC & NETWORKING -------------------
Write-Host "[2/15] Creating VPC and Networking..."

$VPC_JSON = aws ec2 create-vpc --cidr-block $VPC_CIDR --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=chat-app-vpc}]" --region $REGION --output json
$VPC_ID = ($VPC_JSON | ConvertFrom-Json).Vpc.VpcId
Write-Host "  VPC ID: $VPC_ID"

Invoke-Aws "aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-hostnames --region $REGION"
Invoke-Aws "aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-support --region $REGION"

$AZS = aws ec2 describe-availability-zones --region $REGION --query 'AvailabilityZones[?State==`available`].ZoneName' --output json | ConvertFrom-Json
$AZ1 = $AZS[0]
$AZ2 = $AZS[1]
Write-Host "  AZs: $AZ1, $AZ2"

# Public Subnets
$PUB1_JSON = aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.0.1.0/24 --availability-zone $AZ1 --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=chat-app-public-1a}]" --region $REGION --output json
$PUB_SUBNET_1 = ($PUB1_JSON | ConvertFrom-Json).Subnet.SubnetId

$PUB2_JSON = aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.0.2.0/24 --availability-zone $AZ2 --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=chat-app-public-1b}]" --region $REGION --output json
$PUB_SUBNET_2 = ($PUB2_JSON | ConvertFrom-Json).Subnet.SubnetId

Invoke-Aws "aws ec2 modify-subnet-attribute --subnet-id $PUB_SUBNET_1 --map-public-ip-on-launch --region $REGION"
Invoke-Aws "aws ec2 modify-subnet-attribute --subnet-id $PUB_SUBNET_2 --map-public-ip-on-launch --region $REGION"

# Private Subnets
$PRIV1_JSON = aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.0.3.0/24 --availability-zone $AZ1 --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=chat-app-private-1a}]" --region $REGION --output json
$PRIV_SUBNET_1 = ($PRIV1_JSON | ConvertFrom-Json).Subnet.SubnetId

$PRIV2_JSON = aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.0.4.0/24 --availability-zone $AZ2 --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=chat-app-private-1b}]" --region $REGION --output json
$PRIV_SUBNET_2 = ($PRIV2_JSON | ConvertFrom-Json).Subnet.SubnetId

# Internet Gateway
$IGW_JSON = aws ec2 create-internet-gateway --tag-specifications "ResourceType=internet-gateway,Tags=[{Key=Name,Value=chat-app-igw}]" --region $REGION --output json
$IGW_ID = ($IGW_JSON | ConvertFrom-Json).InternetGateway.InternetGatewayId
Invoke-Aws "aws ec2 attach-internet-gateway --internet-gateway-id $IGW_ID --vpc-id $VPC_ID --region $REGION"

# Public Route Table
$PUB_RT_JSON = aws ec2 create-route-table --vpc-id $VPC_ID --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=chat-app-public-rt}]" --region $REGION --output json
$PUB_RT = ($PUB_RT_JSON | ConvertFrom-Json).RouteTable.RouteTableId
Invoke-Aws "aws ec2 create-route --route-table-id $PUB_RT --destination-cidr-block 0.0.0.0/0 --gateway-id $IGW_ID --region $REGION"
Invoke-Aws "aws ec2 associate-route-table --route-table-id $PUB_RT --subnet-id $PUB_SUBNET_1 --region $REGION"
Invoke-Aws "aws ec2 associate-route-table --route-table-id $PUB_RT --subnet-id $PUB_SUBNET_2 --region $REGION"

# NAT Gateways
$EIP1_JSON = aws ec2 allocate-address --domain vpc --region $REGION --output json
$EIP1 = ($EIP1_JSON | ConvertFrom-Json).AllocationId
$EIP2_JSON = aws ec2 allocate-address --domain vpc --region $REGION --output json
$EIP2 = ($EIP2_JSON | ConvertFrom-Json).AllocationId

$NAT1_JSON = aws ec2 create-nat-gateway --subnet-id $PUB_SUBNET_1 --allocation-id $EIP1 --tag-specifications "ResourceType=natgateway,Tags=[{Key=Name,Value=chat-app-nat-1a}]" --region $REGION --output json
$NAT1 = ($NAT1_JSON | ConvertFrom-Json).NatGateway.NatGatewayId

$NAT2_JSON = aws ec2 create-nat-gateway --subnet-id $PUB_SUBNET_2 --allocation-id $EIP2 --tag-specifications "ResourceType=natgateway,Tags=[{Key=Name,Value=chat-app-nat-1b}]" --region $REGION --output json
$NAT2 = ($NAT2_JSON | ConvertFrom-Json).NatGateway.NatGatewayId

Write-Host "  Waiting for NAT Gateways to become available (~2 minutes)..."
Invoke-Aws "aws ec2 wait nat-gateway-available --nat-gateway-ids $NAT1 $NAT2 --region $REGION"

# Private Route Tables
$PRIV_RT1_JSON = aws ec2 create-route-table --vpc-id $VPC_ID --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=chat-app-private-rt-1a}]" --region $REGION --output json
$PRIV_RT1 = ($PRIV_RT1_JSON | ConvertFrom-Json).RouteTable.RouteTableId
Invoke-Aws "aws ec2 create-route --route-table-id $PRIV_RT1 --destination-cidr-block 0.0.0.0/0 --nat-gateway-id $NAT1 --region $REGION"
Invoke-Aws "aws ec2 associate-route-table --route-table-id $PRIV_RT1 --subnet-id $PRIV_SUBNET_1 --region $REGION"

$PRIV_RT2_JSON = aws ec2 create-route-table --vpc-id $VPC_ID --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=chat-app-private-rt-1b}]" --region $REGION --output json
$PRIV_RT2 = ($PRIV_RT2_JSON | ConvertFrom-Json).RouteTable.RouteTableId
Invoke-Aws "aws ec2 create-route --route-table-id $PRIV_RT2 --destination-cidr-block 0.0.0.0/0 --nat-gateway-id $NAT2 --region $REGION"
Invoke-Aws "aws ec2 associate-route-table --route-table-id $PRIV_RT2 --subnet-id $PRIV_SUBNET_2 --region $REGION"

# ------------------- STEP 3: SECURITY GROUPS -------------------
Write-Host "[3/15] Creating Security Groups..."

$ALB_SG_JSON = aws ec2 create-security-group --group-name chat-app-alb-sg --description "ALB inbound rules" --vpc-id $VPC_ID --region $REGION --output json
$ALB_SG = ($ALB_SG_JSON | ConvertFrom-Json).GroupId
Invoke-Aws "aws ec2 authorize-security-group-ingress --group-id $ALB_SG --protocol tcp --port 80 --cidr 0.0.0.0/0 --region $REGION"

$ECS_SG_JSON = aws ec2 create-security-group --group-name chat-app-ecs-sg --description "ECS tasks inbound rules" --vpc-id $VPC_ID --region $REGION --output json
$ECS_SG = ($ECS_SG_JSON | ConvertFrom-Json).GroupId
Invoke-Aws "aws ec2 authorize-security-group-ingress --group-id $ECS_SG --protocol all --source-group $ALB_SG --region $REGION"
Invoke-Aws "aws ec2 authorize-security-group-ingress --group-id $ECS_SG --protocol all --source-group $ECS_SG --region $REGION"

$RABBITMQ_SG_JSON = aws ec2 create-security-group --group-name chat-app-rabbitmq-sg --description "RabbitMQ and Management UI" --vpc-id $VPC_ID --region $REGION --output json
$RABBITMQ_SG = ($RABBITMQ_SG_JSON | ConvertFrom-Json).GroupId
Invoke-Aws "aws ec2 authorize-security-group-ingress --group-id $RABBITMQ_SG --protocol tcp --port 5672 --source-group $ECS_SG --region $REGION"
Invoke-Aws "aws ec2 authorize-security-group-ingress --group-id $RABBITMQ_SG --protocol tcp --port 15672 --cidr $USER_IP --region $REGION"

# ------------------- STEP 4: ECR REPOSITORIES -------------------
Write-Host "[4/15] Creating ECR Repositories..."
$repos = @("chat-app/user-service", "chat-app/mail-service", "chat-app/chat-service", "chat-app/rabbitmq")
foreach ($repo in $repos) {
    if (-not (Test-AwsResource "aws ecr describe-repositories --repository-names $repo --region $REGION")) {
        Write-Host "  Creating $repo"
        Invoke-Aws "aws ecr create-repository --repository-name $repo --region $REGION"
    } else {
        Write-Host "  $repo already exists"
    }
}

# ------------------- STEP 5: BUILD & PUSH DOCKER IMAGES -------------------
Write-Host "[5/15] Building and Pushing Docker Images..."
Invoke-Aws "aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

Write-Host "  Building User Service..."
Invoke-Aws "docker build -t chat-app/user-service:latest ./backend/user"
Invoke-Aws "docker tag chat-app/user-service:latest $USER_IMAGE"
Invoke-Aws "docker push $USER_IMAGE"

Write-Host "  Building Mail Service..."
Invoke-Aws "docker build -t chat-app/mail-service:latest ./backend/mail"
Invoke-Aws "docker tag chat-app/mail-service:latest $MAIL_IMAGE"
Invoke-Aws "docker push $MAIL_IMAGE"

Write-Host "  Building Chat Service..."
Invoke-Aws "docker build -t chat-app/chat-service:latest ./backend/chat"
Invoke-Aws "docker tag chat-app/chat-service:latest $CHAT_IMAGE"
Invoke-Aws "docker push $CHAT_IMAGE"

Write-Host "  Pulling and Pushing RabbitMQ..."
Invoke-Aws "docker pull rabbitmq:3.13-management-alpine"
Invoke-Aws "docker tag rabbitmq:3.13-management-alpine $RABBITMQ_IMAGE"
Invoke-Aws "docker push $RABBITMQ_IMAGE"

# ------------------- STEP 6: CLOUD MAP NAMESPACE -------------------
Write-Host "[6/15] Creating Cloud Map Namespace..."
$NS_OP_JSON = aws servicediscovery create-private-dns-namespace --name $NAMESPACE_NAME --vpc $VPC_ID --region $REGION --output json
$NS_OP_ID = ($NS_OP_JSON | ConvertFrom-Json).OperationId

Write-Host "  Waiting 60 seconds for namespace to propagate..."
Start-Sleep -Seconds 60

$NAMESPACE_ID = aws servicediscovery list-namespaces --region $REGION --query "Namespaces[?Name=='$NAMESPACE_NAME'].Id" --output text
Write-Host "  Namespace ID: $NAMESPACE_ID"

# ------------------- STEP 7: CLOUD MAP SERVICES -------------------
Write-Host "[7/15] Creating Cloud Map Services..."

function New-CloudMapService {
    param([string]$Name, [string]$NsId)
    $JSON = aws servicediscovery create-service --name $Name --namespace-id $NsId --dns-config "NamespaceId=$NsId,RoutingPolicy=MULTIVALUE,DnsRecords=[{Type=A,TTL=60}]" --region $REGION --output json
    $ID = ($JSON | ConvertFrom-Json).Service.Id
    $ARN = aws servicediscovery get-service --id $ID --region $REGION --query 'Service.Arn' --output text
    return $ARN
}

$USER_SD_ARN = New-CloudMapService -Name "user-service" -NsId $NAMESPACE_ID
$MAIL_SD_ARN = New-CloudMapService -Name "mail-service" -NsId $NAMESPACE_ID
$CHAT_SD_ARN = New-CloudMapService -Name "chat-service" -NsId $NAMESPACE_ID
$RABBITMQ_SD_ARN = New-CloudMapService -Name "rabbitmq" -NsId $NAMESPACE_ID

# ------------------- STEP 8: ALB & TARGET GROUPS -------------------
Write-Host "[8/15] Creating ALB and Target Groups..."

$ALB_JSON = aws elbv2 create-load-balancer --name chat-app-alb --subnets $PUB_SUBNET_1 $PUB_SUBNET_2 --security-groups $ALB_SG --scheme internet-facing --type application --ip-address-type ipv4 --region $REGION --output json
$ALB_ARN = ($ALB_JSON | ConvertFrom-Json).LoadBalancers[0].LoadBalancerArn
$ALB_DNS = aws elbv2 describe-load-balancers --load-balancer-arns $ALB_ARN --region $REGION --query 'LoadBalancers[0].DNSName' --output text
Write-Host "  ALB DNS: $ALB_DNS"

$USER_TG_JSON = aws elbv2 create-target-group --name user-service-tg --protocol HTTP --port $USER_PORT --vpc-id $VPC_ID --target-type ip --health-check-path "/api/v1/users/health" --health-check-interval-seconds 30 --health-check-timeout-seconds 5 --healthy-threshold-count 2 --unhealthy-threshold-count 3 --region $REGION --output json
$USER_TG_ARN = ($USER_TG_JSON | ConvertFrom-Json).TargetGroups[0].TargetGroupArn

$MAIL_TG_JSON = aws elbv2 create-target-group --name mail-service-tg --protocol HTTP --port $MAIL_PORT --vpc-id $VPC_ID --target-type ip --health-check-path "/api/mail/health" --health-check-interval-seconds 30 --health-check-timeout-seconds 5 --healthy-threshold-count 2 --unhealthy-threshold-count 3 --region $REGION --output json
$MAIL_TG_ARN = ($MAIL_TG_JSON | ConvertFrom-Json).TargetGroups[0].TargetGroupArn

$CHAT_TG_JSON = aws elbv2 create-target-group --name chat-service-tg --protocol HTTP --port $CHAT_PORT --vpc-id $VPC_ID --target-type ip --health-check-path "/api/v1/chat/health" --health-check-interval-seconds 30 --health-check-timeout-seconds 5 --healthy-threshold-count 2 --unhealthy-threshold-count 3 --region $REGION --output json
$CHAT_TG_ARN = ($CHAT_TG_JSON | ConvertFrom-Json).TargetGroups[0].TargetGroupArn

# Listener with default 404
$LISTENER_JSON = aws elbv2 create-listener --load-balancer-arn $ALB_ARN --protocol HTTP --port 80 --default-actions Type=fixed-response,FixedResponseConfig="{StatusCode=404,ContentType=application/json,MessageBody=Not Found}" --region $REGION --output json
$LISTENER_ARN = ($LISTENER_JSON | ConvertFrom-Json).Listeners[0].ListenerArn

# Path-based rules
Invoke-Aws "aws elbv2 create-rule --listener-arn $LISTENER_ARN --priority 1 --conditions 'Field=path-pattern,Values=/api/v1/users/*' --actions Type=forward,TargetGroupArn=$USER_TG_ARN --region $REGION"
Invoke-Aws "aws elbv2 create-rule --listener-arn $LISTENER_ARN --priority 2 --conditions 'Field=path-pattern,Values=/api/mail/*' --actions Type=forward,TargetGroupArn=$MAIL_TG_ARN --region $REGION"
Invoke-Aws "aws elbv2 create-rule --listener-arn $LISTENER_ARN --priority 3 --conditions 'Field=path-pattern,Values=/api/v1/chat/*' --actions Type=forward,TargetGroupArn=$CHAT_TG_ARN --region $REGION"
Invoke-Aws "aws elbv2 create-rule --listener-arn $LISTENER_ARN --priority 4 --conditions 'Field=path-pattern,Values=/socket.io/*' --actions Type=forward,TargetGroupArn=$CHAT_TG_ARN --region $REGION"

# ------------------- STEP 9: ECS CLUSTER -------------------
Write-Host "[9/15] Creating ECS Cluster..."
Invoke-Aws "aws ecs create-cluster --cluster-name $CLUSTER_NAME --region $REGION"

# ------------------- STEP 10: TASK DEFINITIONS -------------------
Write-Host "[10/15] Registering Task Definitions..."

# User Service
$userTask = @{
    family = "user-service"
    networkMode = "awsvpc"
    requiresCompatibilities = @("FARGATE")
    cpu = "256"
    memory = "512"
    executionRoleArn = "arn:aws:iam::$ACCOUNT_ID`:role/ecsTaskExecutionRole"
    taskRoleArn = "arn:aws:iam::$ACCOUNT_ID`:role/ecsTaskRole"
    containerDefinitions = @(
        @{
            name = "user-service"
            image = $USER_IMAGE
            essential = $true
            portMappings = @(@{ containerPort = $USER_PORT; protocol = "tcp" })
            environment = @(
                @{ name = "NODE_ENV"; value = "production" }
                @{ name = "PORT"; value = "$USER_PORT" }
                @{ name = "Rabbitmq_Host"; value = "rabbitmq.$NAMESPACE_NAME" }
                @{ name = "Rabbitmq_Username"; value = "admin" }
                @{ name = "Rabbitmq_Password"; value = "admin123" }
                @{ name = "JWT_EXPIRES_IN"; value = "15d" }
                @{ name = "MONGO_URI"; value = $USER_MONGO_URI }
                @{ name = "REDIS_URL"; value = $USER_REDIS_URL }
                @{ name = "JWT_PRIVATE_KEY_BASE64"; value = $USER_JWT_PRIVATE_KEY }
                @{ name = "JWT_PUBLIC_KEY_BASE64"; value = $USER_JWT_PUBLIC_KEY }
            )
            logConfiguration = @{
                logDriver = "awslogs"
                options = @{
                    "awslogs-group" = "/ecs/chat-app/user-service"
                    "awslogs-region" = $REGION
                    "awslogs-stream-prefix" = "ecs"
                    "awslogs-create-group" = "true"
                }
            }
            healthCheck = @{
                command = @(
                    "CMD-SHELL"
                    "node --eval `"require('http').get('http://127.0.0.1:$USER_PORT/api/v1/users/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))`""
                )
                interval = 30
                timeout = 5
                retries = 3
                startPeriod = 15
            }
        }
    )
}
$userTask | ConvertTo-Json -Depth 10 | Set-Content -Path "$env:TEMP/user-task.json"
Invoke-Aws "aws ecs register-task-definition --cli-input-json file://$env:TEMP/user-task.json --region $REGION"

# Mail Service
$mailTask = @{
    family = "mail-service"
    networkMode = "awsvpc"
    requiresCompatibilities = @("FARGATE")
    cpu = "256"
    memory = "512"
    executionRoleArn = "arn:aws:iam::$ACCOUNT_ID`:role/ecsTaskExecutionRole"
    taskRoleArn = "arn:aws:iam::$ACCOUNT_ID`:role/ecsTaskRole"
    containerDefinitions = @(
        @{
            name = "mail-service"
            image = $MAIL_IMAGE
            essential = $true
            portMappings = @(@{ containerPort = $MAIL_PORT; protocol = "tcp" })
            environment = @(
                @{ name = "NODE_ENV"; value = "production" }
                @{ name = "PORT"; value = "$MAIL_PORT" }
                @{ name = "Rabbitmq_Host"; value = "rabbitmq.$NAMESPACE_NAME" }
                @{ name = "Rabbitmq_Username"; value = "admin" }
                @{ name = "Rabbitmq_Password"; value = "admin123" }
                @{ name = "SMTP_USER"; value = $MAIL_SMTP_USER }
                @{ name = "SMTP_PASS"; value = $MAIL_SMTP_PASS }
            )
            logConfiguration = @{
                logDriver = "awslogs"
                options = @{
                    "awslogs-group" = "/ecs/chat-app/mail-service"
                    "awslogs-region" = $REGION
                    "awslogs-stream-prefix" = "ecs"
                    "awslogs-create-group" = "true"
                }
            }
            healthCheck = @{
                command = @(
                    "CMD-SHELL"
                    "node --eval `"require('http').get('http://127.0.0.1:$MAIL_PORT/api/mail/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))`""
                )
                interval = 30
                timeout = 5
                retries = 3
                startPeriod = 15
            }
        }
    )
}
$mailTask | ConvertTo-Json -Depth 10 | Set-Content -Path "$env:TEMP/mail-task.json"
Invoke-Aws "aws ecs register-task-definition --cli-input-json file://$env:TEMP/mail-task.json --region $REGION"

# Chat Service
$chatTask = @{
    family = "chat-service"
    networkMode = "awsvpc"
    requiresCompatibilities = @("FARGATE")
    cpu = "256"
    memory = "512"
    executionRoleArn = "arn:aws:iam::$ACCOUNT_ID`:role/ecsTaskExecutionRole"
    taskRoleArn = "arn:aws:iam::$ACCOUNT_ID`:role/ecsTaskRole"
    containerDefinitions = @(
        @{
            name = "chat-service"
            image = $CHAT_IMAGE
            essential = $true
            portMappings = @(@{ containerPort = $CHAT_PORT; protocol = "tcp" })
            environment = @(
                @{ name = "NODE_ENV"; value = "production" }
                @{ name = "PORT"; value = "$CHAT_PORT" }
                @{ name = "USER_SERVICE"; value = "http://user-service.$NAMESPACE_NAME`:$USER_PORT" }
                @{ name = "MONGO_URI"; value = $CHAT_MONGO_URI }
                @{ name = "JWT_PUBLIC_KEY"; value = $CHAT_JWT_PUBLIC_KEY }
                @{ name = "Cloud_Name"; value = $CHAT_CLOUD_NAME }
                @{ name = "Api_Key"; value = $CHAT_API_KEY }
                @{ name = "Api_Secret"; value = $CHAT_API_SECRET }
            )
            logConfiguration = @{
                logDriver = "awslogs"
                options = @{
                    "awslogs-group" = "/ecs/chat-app/chat-service"
                    "awslogs-region" = $REGION
                    "awslogs-stream-prefix" = "ecs"
                    "awslogs-create-group" = "true"
                }
            }
            healthCheck = @{
                command = @(
                    "CMD-SHELL"
                    "node --eval `"require('http').get('http://127.0.0.1:$CHAT_PORT/api/v1/chat/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))`""
                )
                interval = 30
                timeout = 5
                retries = 3
                startPeriod = 15
            }
        }
    )
}
$chatTask | ConvertTo-Json -Depth 10 | Set-Content -Path "$env:TEMP/chat-task.json"
Invoke-Aws "aws ecs register-task-definition --cli-input-json file://$env:TEMP/chat-task.json --region $REGION"

# RabbitMQ
$rabbitTask = @{
    family = "rabbitmq"
    networkMode = "awsvpc"
    requiresCompatibilities = @("FARGATE")
    cpu = "256"
    memory = "512"
    executionRoleArn = "arn:aws:iam::$ACCOUNT_ID`:role/ecsTaskExecutionRole"
    taskRoleArn = "arn:aws:iam::$ACCOUNT_ID`:role/ecsTaskRole"
    containerDefinitions = @(
        @{
            name = "rabbitmq"
            image = $RABBITMQ_IMAGE
            essential = $true
            portMappings = @(
                @{ containerPort = 5672; protocol = "tcp" }
                @{ containerPort = 15672; protocol = "tcp" }
            )
            environment = @(
                @{ name = "RABBITMQ_DEFAULT_USER"; value = "admin" }
                @{ name = "RABBITMQ_DEFAULT_PASS"; value = "admin123" }
            )
            logConfiguration = @{
                logDriver = "awslogs"
                options = @{
                    "awslogs-group" = "/ecs/chat-app/rabbitmq"
                    "awslogs-region" = $REGION
                    "awslogs-stream-prefix" = "ecs"
                    "awslogs-create-group" = "true"
                }
            }
        }
    )
}
$rabbitTask | ConvertTo-Json -Depth 10 | Set-Content -Path "$env:TEMP/rabbitmq-task.json"
Invoke-Aws "aws ecs register-task-definition --cli-input-json file://$env:TEMP/rabbitmq-task.json --region $REGION"

# ------------------- STEP 11: ECS SERVICES -------------------
Write-Host "[11/15] Creating ECS Services..."

Invoke-Aws "aws ecs create-service --cluster $CLUSTER_NAME --service-name user-service --task-definition user-service --desired-count 1 --launch-type FARGATE --network-configuration `"awsvpcConfiguration={subnets=[$PRIV_SUBNET_1,$PRIV_SUBNET_2],securityGroups=[$ECS_SG],assignPublicIp=DISABLED}`" --load-balancers `"targetGroupArn=$USER_TG_ARN,containerName=user-service,containerPort=$USER_PORT`" --service-registries `"registryArn=$USER_SD_ARN`" --health-check-grace-period-seconds 60 --region $REGION"

Invoke-Aws "aws ecs create-service --cluster $CLUSTER_NAME --service-name mail-service --task-definition mail-service --desired-count 1 --launch-type FARGATE --network-configuration `"awsvpcConfiguration={subnets=[$PRIV_SUBNET_1,$PRIV_SUBNET_2],securityGroups=[$ECS_SG],assignPublicIp=DISABLED}`" --load-balancers `"targetGroupArn=$MAIL_TG_ARN,containerName=mail-service,containerPort=$MAIL_PORT`" --service-registries `"registryArn=$MAIL_SD_ARN`" --health-check-grace-period-seconds 60 --region $REGION"

Invoke-Aws "aws ecs create-service --cluster $CLUSTER_NAME --service-name chat-service --task-definition chat-service --desired-count 1 --launch-type FARGATE --network-configuration `"awsvpcConfiguration={subnets=[$PRIV_SUBNET_1,$PRIV_SUBNET_2],securityGroups=[$ECS_SG],assignPublicIp=DISABLED}`" --load-balancers `"targetGroupArn=$CHAT_TG_ARN,containerName=chat-service,containerPort=$CHAT_PORT`" --service-registries `"registryArn=$CHAT_SD_ARN`" --health-check-grace-period-seconds 60 --region $REGION"

Invoke-Aws "aws ecs create-service --cluster $CLUSTER_NAME --service-name rabbitmq --task-definition rabbitmq --desired-count 1 --launch-type FARGATE --network-configuration `"awsvpcConfiguration={subnets=[$PRIV_SUBNET_1,$PRIV_SUBNET_2],securityGroups=[$RABBITMQ_SG],assignPublicIp=DISABLED}`" --service-registries `"registryArn=$RABBITMQ_SD_ARN`" --region $REGION"

# ------------------- STEP 12: S3 BUCKET -------------------
Write-Host "[12/15] Creating and Configuring S3 Bucket..."

if (-not (Test-AwsResource "aws s3api head-bucket --bucket $BUCKET_NAME --region $REGION")) {
    Write-Host "  Creating bucket $BUCKET_NAME"
    Invoke-Aws "aws s3api create-bucket --bucket $BUCKET_NAME --region $REGION --create-bucket-configuration LocationConstraint=$REGION"
} else {
    Write-Host "  Bucket already exists"
}

Invoke-Aws "aws s3api put-bucket-website --bucket $BUCKET_NAME --website-configuration '{`"IndexDocument`":{`"Suffix`":`"index.html`"},`"ErrorDocument`":{`"Key`":`"index.html`"}}' --region $REGION"

$S3_POLICY = @"
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "PublicReadGetObject",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::$BUCKET_NAME/*"
        }
    ]
}
"@
Set-Content -Path "$env:TEMP/s3-policy.json" -Value $S3_POLICY
Invoke-Aws "aws s3api put-bucket-policy --bucket $BUCKET_NAME --policy file://$env:TEMP/s3-policy.json --region $REGION"

# ------------------- STEP 13: SUMMARY -------------------
Write-Host ""
Write-Host "=========================================="
Write-Host "INFRASTRUCTURE CREATED SUCCESSFULLY"
Write-Host "=========================================="
Write-Host "ALB DNS: http://$ALB_DNS"
Write-Host "S3 Website: http://$BUCKET_NAME.s3-website.$REGION.amazonaws.com"
Write-Host ""
Write-Host "MANUAL STEPS YOU MUST DO NOW:"
Write-Host "1. Update your frontend API base URLs:"
Write-Host "   export const user_service = 'http://$ALB_DNS';"
Write-Host "   export const chat_service = 'http://$ALB_DNS';"
Write-Host ""
Write-Host "2. Rebuild your Next.js frontend:"
Write-Host "   npm run build"
Write-Host ""
Write-Host "3. Upload to S3:"
Write-Host "   aws s3 sync out s3://$BUCKET_NAME --delete"
Write-Host ""
Write-Host "4. Test endpoints:"
Write-Host "   curl http://$ALB_DNS/api/v1/users/health"
Write-Host "   curl http://$ALB_DNS/api/mail/health"
Write-Host "   curl http://$ALB_DNS/api/v1/chat/health"
Write-Host ""
Write-Host "5. RabbitMQ Management UI:"
Write-Host "   Find private IP in ECS task details, access port 15672"
Write-Host "   Username: admin | Password: admin123"
Write-Host "=========================================="