#Requires -Version 5.1
$REGION = "ap-south-1"
$CLUSTER_NAME = "chat-app-cluster"
$NAMESPACE_NAME = "chat-app.local"
$BUCKET_NAME = "chat-app-frontend-taha-1211"

Write-Host "=========================================="
Write-Host "AWS Chat App Resource Diagnostic"
Write-Host "Region: $REGION"
Write-Host "=========================================="
Write-Host ""

# Helper: Run AWS command safely, return output or "NOT FOUND"
function Get-AwsResource {
    param(
        [string]$Description,
        [string]$Command
    )
    Write-Host -NoNewline "[$Description] ... "
    try {
        $output = Invoke-Expression $Command 2>$null
        if ($LASTEXITCODE -eq 0 -and $output -and $output.Trim() -ne "" -and $output.Trim() -ne "None") {
            Write-Host "FOUND" -ForegroundColor Green
            return $output
        } else {
            Write-Host "NOT FOUND" -ForegroundColor Red
            return $null
        }
    } catch {
        Write-Host "NOT FOUND" -ForegroundColor Red
        return $null
    }
}

# Helper: Parse JSON arrays and count items
function Show-ArrayCount {
    param([string]$JsonText)
    if (-not $JsonText) { return 0 }
    try {
        $parsed = $JsonText | ConvertFrom-Json
        if ($parsed -is [array]) { return $parsed.Count }
        if ($parsed.PSObject.Properties.Name -contains "Count") { return $parsed.Count }
        return 1
    } catch {
        return 0
    }
}

# ------------------- IAM -------------------
Write-Host "--- IAM ROLES ---"
Get-AwsResource "IAM Role: ecsTaskExecutionRole" "aws iam get-role --role-name ecsTaskExecutionRole --query 'Role.RoleName' --output text --region $REGION"
Get-AwsResource "IAM Role: ecsTaskRole" "aws iam get-role --role-name ecsTaskRole --query 'Role.RoleName' --output text --region $REGION"
Write-Host ""

# ------------------- VPC & NETWORKING -------------------
Write-Host "--- VPC & NETWORKING ---"
$vpcOutput = Get-AwsResource "VPC: chat-app-vpc" "aws ec2 describe-vpcs --filters `"Name=tag:Name,Values=chat-app-vpc`" --query 'Vpcs[0].[VpcId,CidrBlock]' --output text --region $REGION"
if ($vpcOutput) {
    $vpcId = ($vpcOutput -split "`t")[0]
    
    $subnets = Get-AwsResource "Subnets in VPC" "aws ec2 describe-subnets --filters `"Name=vpc-id,Values=$vpcId`" --query 'Subnets[*].[SubnetId,CidrBlock,Tags[?Key==`Name`].Value | [0]]' --output text --region $REGION"
    if ($subnets) { Write-Host $subnets }
    
    $sgs = Get-AwsResource "Security Groups" "aws ec2 describe-security-groups --filters `"Name=vpc-id,Values=$vpcId`" --query 'SecurityGroups[?GroupName != `default`].[GroupName,GroupId]' --output text --region $REGION"
    if ($sgs) { Write-Host $sgs }
    
    $igw = Get-AwsResource "Internet Gateway" "aws ec2 describe-internet-gateways --filters `"Name=attachment.vpc-id,Values=$vpcId`" --query 'InternetGateways[0].InternetGatewayId' --output text --region $REGION"
    $nats = Get-AwsResource "NAT Gateways" "aws ec2 describe-nat-gateways --filter `"Name=vpc-id,Values=$vpcId`" --query 'NatGateways[*].[NatGatewayId,State]' --output text --region $REGION"
    $eips = Get-AwsResource "Elastic IPs" "aws ec2 describe-addresses --region $REGION --query 'Addresses[*].[AllocationId,PublicIp]' --output text"
}
Write-Host ""

# ------------------- ALB & TARGET GROUPS -------------------
Write-Host "--- ALB & TARGET GROUPS ---"
$albOutput = Get-AwsResource "ALB: chat-app-alb" "aws elbv2 describe-load-balancers --names chat-app-alb --region $REGION --query 'LoadBalancers[0].[LoadBalancerArn,DNSName,State]' --output text"
if ($albOutput) {
    $albArn = ($albOutput -split "`t")[0]
    $listeners = Get-AwsResource "ALB Listeners" "aws elbv2 describe-listeners --load-balancer-arn $albArn --region $REGION --query 'Listeners[*].[Port,Protocol]' --output text"
    $rules = Get-AwsResource "ALB Rules" "aws elbv2 describe-rules --listener-arn (aws elbv2 describe-listeners --load-balancer-arn $albArn --region $REGION --query 'Listeners[0].ListenerArn' --output text) --region $REGION --query 'Rules[*].[Priority,Actions[0].Type]' --output text"
}

$tgs = @("user-service-tg", "mail-service-tg", "chat-service-tg")
foreach ($tg in $tgs) {
    $tgOutput = Get-AwsResource "Target Group: $tg" "aws elbv2 describe-target-groups --names $tg --region $REGION --query 'TargetGroups[0].[TargetGroupArn,Port,HealthCheckPath]' --output text"
    if ($tgOutput) {
        $tgArn = ($tgOutput -split "`t")[0]
        $targets = Get-AwsResource "  -> Targets in $tg" "aws elbv2 describe-target-health --target-group-arn $tgArn --region $REGION --query 'TargetHealthDescriptions[*].[Target.Id,TargetHealth.State]' --output text"
    }
}
Write-Host ""

# ------------------- ECR -------------------
Write-Host "--- ECR REPOSITORIES ---"
$repos = @("chat-app/user-service", "chat-app/mail-service", "chat-app/chat-service", "chat-app/rabbitmq")
foreach ($repo in $repos) {
    Get-AwsResource "ECR: $repo" "aws ecr describe-repositories --repository-names $repo --region $REGION --query 'repositories[0].[repositoryName,repositoryUri]' --output text"
}
Write-Host ""

# ------------------- CLOUD MAP -------------------
Write-Host "--- CLOUD MAP ---"
$nsOutput = Get-AwsResource "Namespace: $NAMESPACE_NAME" "aws servicediscovery list-namespaces --region $REGION --query `"Namespaces[?Name=='$NAMESPACE_NAME'].[Name,Id]`" --output text"
if ($nsOutput) {
    $nsId = ($nsOutput -split "`t")[1]
    $services = Get-AwsResource "Cloud Map Services" "aws servicediscovery list-services --region $REGION --query 'Services[*].[Name,Id]' --output text"
    if ($services) { Write-Host $services }
}
Write-Host ""

# ------------------- ECS -------------------
Write-Host "--- ECS ---"
$clusters = Get-AwsResource "ECS Clusters" "aws ecs list-clusters --region $REGION --query 'clusterArns' --output text"
if ($clusters -and $clusters -like "*$CLUSTER_NAME*") {
    Get-AwsResource "Cluster: $CLUSTER_NAME" "aws ecs describe-clusters --clusters $CLUSTER_NAME --region $REGION --query 'clusters[0].[clusterName,status,registeredContainerInstancesCount]' --output text"
    
    $services = Get-AwsResource "ECS Services" "aws ecs list-services --cluster $CLUSTER_NAME --region $REGION --query 'serviceArns' --output text"
    if ($services) {
        foreach ($svcArn in ($services -split "\s+")) {
            if ($svcArn) {
                $svcName = $svcArn.Split("/")[-1]
                $svcDetail = aws ecs describe-services --cluster $CLUSTER_NAME --services $svcName --region $REGION --query "services[0].[serviceName,status,runningCount,desiredCount]" --output text 2>$null
                if ($svcDetail) {
                    Write-Host "  -> $svcDetail"
                }
            }
        }
    }
    
    $tasks = Get-AwsResource "ECS Tasks" "aws ecs list-tasks --cluster $CLUSTER_NAME --region $REGION --query 'taskArns' --output text"
    if ($tasks -and $tasks -ne "None") {
        foreach ($taskArn in ($tasks -split "\s+")) {
            if ($taskArn) {
                $taskDetail = aws ecs describe-tasks --cluster $CLUSTER_NAME --tasks $taskArn --region $REGION --query "tasks[0].[group,lastStatus,attachments[0].details[?name=='networkInterfaceId'].value | [0]]" --output text 2>$null
                if ($taskDetail) {
                    Write-Host "  -> Task: $taskDetail"
                    $eniId = ($taskDetail -split "`t")[-1]
                    if ($eniId -and $eniId -ne "None") {
                        $privateIp = aws ec2 describe-network-interfaces --network-interface-ids $eniId --region $REGION --query 'NetworkInterfaces[0].PrivateIpAddress' --output text 2>$null
                        if ($privateIp -and $privateIp -ne "None") {
                            Write-Host "     Private IP: $privateIp"
                        }
                    }
                }
            }
        }
    }
}
Write-Host ""

# ------------------- S3 -------------------
Write-Host "--- S3 ---"
$buckets = Get-AwsResource "S3 Buckets" "aws s3api list-buckets --query 'Buckets[*].Name' --output text"
if ($buckets -and $buckets -like "*$BUCKET_NAME*") {
    $bucketRegion = aws s3api get-bucket-location --bucket $BUCKET_NAME --region $REGION --query 'LocationConstraint' --output text 2>$null
    Write-Host "  -> Bucket $BUCKET_NAME exists in region: $bucketRegion"
    
    $website = aws s3api get-bucket-website --bucket $BUCKET_NAME --region $REGION 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  -> Static website hosting: ENABLED"
        Write-Host "  -> Website URL: http://$BUCKET_NAME.s3-website.$REGION.amazonaws.com"
    } else {
        Write-Host "  -> Static website hosting: NOT ENABLED"
    }
    
    $objectCount = aws s3 ls s3://$BUCKET_NAME --region $REGION --recursive --summarize 2>$null | Select-String "Total Objects:"
    if ($objectCount) { Write-Host "  -> $objectCount" }
}
Write-Host ""

# ------------------- COST WARNINGS -------------------
Write-Host "--- BILLING RISK CHECK ---"
$natCount = 0
try {
    $vpcIdForNat = aws ec2 describe-vpcs --filters "Name=tag:Name,Values=chat-app-vpc" --region $REGION --query 'Vpcs[0].VpcId' --output text 2>$null
    if ($vpcIdForNat -and $vpcIdForNat -ne "None") {
        $natJson = aws ec2 describe-nat-gateways --filter "Name=vpc-id,Values=$vpcIdForNat" --region $REGION --query 'NatGateways[?State==`available`]' --output json 2>$null
        if ($natJson) {
            $natCount = ($natJson | ConvertFrom-Json).Count
        }
    }
} catch {}

if ($natCount -gt 0) {
    Write-Host "WARNING: $natCount NAT Gateway(s) are RUNNING. Cost ~$0.09/hour each (~$65/month)." -ForegroundColor Yellow
}
if ($albOutput) {
    Write-Host "WARNING: ALB is RUNNING. Cost ~$0.022/hour (~$16/month) + LCU charges." -ForegroundColor Yellow
}
if ($clusters -and $clusters -like "*$CLUSTER_NAME*") {
    Write-Host "WARNING: ECS Cluster exists with services. Fargate tasks cost ~$0.004/vCPU/hour + memory." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=========================================="
Write-Host "DIAGNOSTIC COMPLETE"
Write-Host "Green = Resource exists"
Write-Host "Red = Resource not found"
Write-Host "Yellow = Cost risk"
Write-Host "=========================================="