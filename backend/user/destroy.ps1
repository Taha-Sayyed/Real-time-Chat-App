$REGION = "ap-south-1"
$CLUSTER_NAME = "chat-app-cluster"
$NAMESPACE_NAME = "chat-app.local"
$BUCKET_NAME = "chat-app-frontend-taha-1211"

Write-Host "=========================================="
Write-Host "AWS Chat App Infrastructure Destruction"
Write-Host "Region: $REGION"
Write-Host "=========================================="

# Helper: Run AWS command and show real errors
function Run-Aws {
    param([string]$Command)
    Write-Host "  CMD: $Command"
    Invoke-Expression $Command
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "  FAILED (exit code $LASTEXITCODE) - continuing..."
    }
}

# ------------------- STEP 1: ECS SERVICES -------------------
Write-Host "[1/10] Scaling down ECS Services..."
$services = @("user-service", "mail-service", "chat-service", "rabbitmq")
foreach ($svc in $services) {
    Run-Aws "aws ecs update-service --cluster $CLUSTER_NAME --service $svc --desired-count 0 --region $REGION"
}

Write-Host "Waiting 60 seconds for tasks to stop..."
Start-Sleep -Seconds 60

Write-Host "[2/10] Deleting ECS Services..."
foreach ($svc in $services) {
    Run-Aws "aws ecs delete-service --cluster $CLUSTER_NAME --service $svc --force --region $REGION"
}

# ------------------- STEP 2: ECS CLUSTER -------------------
Write-Host "[3/10] Deleting ECS Cluster..."
Run-Aws "aws ecs delete-cluster --cluster $CLUSTER_NAME --region $REGION"

# ------------------- STEP 3: TASK DEFINITIONS -------------------
Write-Host "[4/10] Deregistering Task Definitions..."
$families = @("user-service", "mail-service", "chat-service", "rabbitmq")
foreach ($fam in $families) {
    $arnsText = (aws ecs list-task-definitions --family-prefix $fam --region $REGION --query 'taskDefinitionArns' --output text 2>$null)
    if ($arnsText) {
        $arns = $arnsText -split "\s+"
        foreach ($arn in $arns) {
            if ($arn -and $arn -ne "None") {
                Write-Host "  Deregistering $arn"
                Run-Aws "aws ecs deregister-task-definition --task-definition $arn --region $REGION"
            }
        }
    }
}

# ------------------- STEP 4: ALB -------------------
Write-Host "[5/10] Deleting ALB..."
$albArn = (aws elbv2 describe-load-balancers --names chat-app-alb --region $REGION --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>$null)
if ($albArn -and $albArn -ne "None" -and $albArn -ne "") {
    Run-Aws "aws elbv2 delete-load-balancer --load-balancer-arn $albArn --region $REGION"
    Write-Host "Waiting 30 seconds for ALB deletion..."
    Start-Sleep -Seconds 30
}

# ------------------- STEP 5: TARGET GROUPS -------------------
Write-Host "[6/10] Deleting Target Groups..."
$tgs = @("user-service-tg", "mail-service-tg", "chat-service-tg")
foreach ($tg in $tgs) {
    $tgArn = (aws elbv2 describe-target-groups --names $tg --region $REGION --query 'TargetGroups[0].TargetGroupArn' --output text 2>$null)
    if ($tgArn -and $tgArn -ne "None" -and $tgArn -ne "") {
        Write-Host "  Deleting $tg"
        Run-Aws "aws elbv2 delete-target-group --target-group-arn $tgArn --region $REGION"
    }
}

# ------------------- STEP 6: CLOUD MAP -------------------
Write-Host "[7/10] Deleting Cloud Map..."
$nsId = (aws servicediscovery list-namespaces --region $REGION --query ""Namespaces[?Name=='$NAMESPACE_NAME'].Id"" --output text 2>$null)
if ($nsId -and $nsId -ne "None" -and $nsId -ne "") {
    $svcIdsText = (aws servicediscovery list-services --region $REGION --query 'Services[?NamespaceId==`'$nsId'`].Id' --output text 2>$null)
    if ($svcIdsText) {
        $svcIds = $svcIdsText -split "\s+"
        foreach ($sid in $svcIds) {
            if ($sid -and $sid -ne "") {
                Write-Host "  Deleting Cloud Map service $sid"
                Run-Aws "aws servicediscovery delete-service --id $sid --region $REGION"
            }
        }
    }
    Start-Sleep -Seconds 10
    Write-Host "  Deleting namespace $nsId"
    Run-Aws "aws servicediscovery delete-namespace --id $nsId --region $REGION"
    Start-Sleep -Seconds 30
}

# ------------------- STEP 7: ECR -------------------
Write-Host "[8/10] Deleting ECR Repositories..."
$repos = @("chat-app/user-service", "chat-app/mail-service", "chat-app/chat-service", "chat-app/rabbitmq")
foreach ($repo in $repos) {
    Write-Host "  Deleting $repo"
    Run-Aws "aws ecr delete-repository --repository-name $repo --force --region $REGION"
}

# ------------------- STEP 8: S3 -------------------
Write-Host "[9/10] Emptying and Deleting S3 Bucket..."
Run-Aws "aws s3 rm s3://$BUCKET_NAME --recursive --region $REGION"
Run-Aws "aws s3api delete-bucket --bucket $BUCKET_NAME --region $REGION"

# ------------------- STEP 9: VPC & NETWORKING -------------------
Write-Host "[10/10] Deleting VPC and Networking..."
$vpcId = (aws ec2 describe-vpcs --filters "Name=tag:Name,Values=chat-app-vpc" --region $REGION --query 'Vpcs[0].VpcId' --output text 2>$null)
if ($vpcId -and $vpcId -ne "None" -and $vpcId -ne "") {
    Write-Host "  VPC ID: $vpcId"

    # NAT Gateways
    $natGwsText = (aws ec2 describe-nat-gateways --filter "Name=vpc-id,Values=$vpcId" --region $REGION --query 'NatGateways[*].NatGatewayId' --output text 2>$null)
    if ($natGwsText) {
        $natGws = $natGwsText -split "\s+"
        foreach ($nat in $natGws) {
            if ($nat -and $nat -ne "") {
                Write-Host "  Deleting NAT Gateway $nat"
                Run-Aws "aws ec2 delete-nat-gateway --nat-gateway-id $nat --region $REGION"
            }
        }
    }
    Write-Host "  Waiting 90 seconds for NAT Gateways to delete..."
    Start-Sleep -Seconds 90

    # Internet Gateway
    $igwId = (aws ec2 describe-internet-gateways --filters "Name=attachment.vpc-id,Values=$vpcId" --region $REGION --query 'InternetGateways[0].InternetGatewayId' --output text 2>$null)
    if ($igwId -and $igwId -ne "None" -and $igwId -ne "") {
        Write-Host "  Detaching IGW $igwId"
        Run-Aws "aws ec2 detach-internet-gateway --internet-gateway-id $igwId --vpc-id $vpcId --region $REGION"
        Write-Host "  Deleting IGW"
        Run-Aws "aws ec2 delete-internet-gateway --internet-gateway-id $igwId --region $REGION"
    }

    # Subnets
    $subnetsText = (aws ec2 describe-subnets --filters "Name=vpc-id,Values=$vpcId" --region $REGION --query 'Subnets[*].SubnetId' --output text 2>$null)
    if ($subnetsText) {
        $subnets = $subnetsText -split "\s+"
        foreach ($subnet in $subnets) {
            if ($subnet -and $subnet -ne "") {
                Write-Host "  Deleting subnet $subnet"
                Run-Aws "aws ec2 delete-subnet --subnet-id $subnet --region $REGION"
            }
        }
    }

    # Route Tables (non-main)
    $rtbsText = (aws ec2 describe-route-tables --filters "Name=vpc-id,Values=$vpcId" --region $REGION --query 'RouteTables[?length(Associations) == `0` || Associations[0].Main == `false`].RouteTableId' --output text 2>$null)
    if ($rtbsText) {
        $rtbs = $rtbsText -split "\s+"
        foreach ($rtb in $rtbs) {
            if ($rtb -and $rtb -ne "") {
                Write-Host "  Deleting route table $rtb"
                Run-Aws "aws ec2 delete-route-table --route-table-id $rtb --region $REGION"
            }
        }
    }

    # Security Groups (non-default)
    $sgsText = (aws ec2 describe-security-groups --filters "Name=vpc-id,Values=$vpcId" --region $REGION --query 'SecurityGroups[?GroupName != `default`].GroupId' --output text 2>$null)
    if ($sgsText) {
        $sgs = $sgsText -split "\s+"
        foreach ($sg in $sgs) {
            if ($sg -and $sg -ne "") {
                Write-Host "  Deleting security group $sg"
                Run-Aws "aws ec2 delete-security-group --group-id $sg --region $REGION"
            }
        }
    }

    # Elastic IPs
    $eipsText = (aws ec2 describe-addresses --region $REGION --query 'Addresses[*].AllocationId' --output text 2>$null)
    if ($eipsText) {
        $eips = $eipsText -split "\s+"
        foreach ($eip in $eips) {
            if ($eip -and $eip -ne "") {
                Write-Host "  Releasing Elastic IP $eip"
                Run-Aws "aws ec2 release-address --allocation-id $eip --region $REGION"
            }
        }
    }

    # VPC
    Write-Host "  Deleting VPC"
    Run-Aws "aws ec2 delete-vpc --vpc-id $vpcId --region $REGION"
}

Write-Host ""
Write-Host "=========================================="
Write-Host "DESTRUCTION COMPLETE"
Write-Host "Verify in AWS Console that no resources remain."
Write-Host "=========================================="