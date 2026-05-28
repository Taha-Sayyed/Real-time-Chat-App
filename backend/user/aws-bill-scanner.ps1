# ============================================================
# AWS BILL KILLER SCANNER v2 - Skips free defaults, focuses on billable
# ============================================================

$regions = (aws ec2 describe-regions --query "Regions[].RegionName" --output text).Split()
$foundSomething = $false

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  SCANNING FOR ACTUAL BILLABLE RESOURCES" -ForegroundColor Cyan
Write-Host "  (Skipping default VPCs, IGWs, free defaults)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# --- S3 (Global - storage costs money) ---
Write-Host "`n[GLOBAL] S3 Buckets:" -ForegroundColor Yellow
$buckets = (aws s3api list-buckets --query "Buckets[].Name" --output text)
if ($buckets -and $buckets -ne "None") {
    Write-Host "  FOUND: $buckets" -ForegroundColor Red
    $foundSomething = $true
} else {
    Write-Host "  None" -ForegroundColor Green
}

foreach ($r in $regions) {
    Write-Host "`n---------- REGION: $r ----------" -ForegroundColor DarkGray

    # EC2 Instances (THE #1 BILL KILLER)
    $inst = (aws ec2 describe-instances --region $r --query "Reservations[].Instances[?State.Name=='running'].InstanceId" --output text)
    if ($inst -and $inst -ne "None") {
        Write-Host "  RUNNING EC2: $inst" -ForegroundColor Red
        $foundSomething = $true
    }

    # EBS Volumes (Detached volumes cost money!)
    $vols = (aws ec2 describe-volumes --region $r --query "Volumes[?State=='available'].VolumeId" --output text)
    if ($vols -and $vols -ne "None") {
        Write-Host "  DETACHED EBS VOLUMES: $vols" -ForegroundColor Red
        $foundSomething = $true
    }

    # EBS Snapshots (Survive forever, cost storage)
    $snaps = (aws ec2 describe-snapshots --owner-ids self --region $r --query "Snapshots[].SnapshotId" --output text)
    if ($snaps -and $snaps -ne "None") {
        Write-Host "  EBS SNAPSHOTS: $snaps" -ForegroundColor Red
        $foundSomething = $true
    }

    # Elastic IPs (Cost $0.005/hr if unattached)
    $eips = (aws ec2 describe-addresses --region $r --query "Addresses[?AssociationId==null].AllocationId" --output text)
    if ($eips -and $eips -ne "None") {
        Write-Host "  UNATTACHED ELASTIC IPs: $eips" -ForegroundColor Red
        $foundSomething = $true
    }

    # NAT Gateways (~$32/month each)
    $nats = (aws ec2 describe-nat-gateways --region $r --query "NatGateways[?State=='available'].NatGatewayId" --output text)
    if ($nats -and $nats -ne "None") {
        Write-Host "  NAT GATEWAYS: $nats" -ForegroundColor Red
        $foundSomething = $true
    }

    # VPC Endpoints (~$7/month each)
    $vpe = (aws ec2 describe-vpc-endpoints --region $r --query "VpcEndpoints[?State=='Available'].VpcEndpointId" --output text)
    if ($vpe -and $vpe -ne "None") {
        Write-Host "  VPC ENDPOINTS: $vpe" -ForegroundColor Red
        $foundSomething = $true
    }

    # ALB/NLB (Load balancers cost ~$16/month + data)
    $alb = (aws elbv2 describe-load-balancers --region $r --query "LoadBalancers[].LoadBalancerArn" --output text)
    if ($alb -and $alb -ne "None") {
        Write-Host "  ALB/NLB: $alb" -ForegroundColor Red
        $foundSomething = $true
    }

    # ECS Clusters (Fargate tasks cost money)
    $ecs = (aws ecs list-clusters --region $r --query "clusterArns" --output text)
    if ($ecs -and $ecs -ne "None" -and $ecs -ne "[]") {
        Write-Host "  ECS CLUSTERS: $ecs" -ForegroundColor Red
        $foundSomething = $true
    }

    # EKS Clusters (~$72/month each)
    $eks = (aws eks list-clusters --region $r --query "clusters" --output text)
    if ($eks -and $eks -ne "None" -and $eks -ne "[]") {
        Write-Host "  EKS CLUSTERS: $eks" -ForegroundColor Red
        $foundSomething = $true
    }

    # RDS Instances
    $rds = (aws rds describe-db-instances --region $r --query "DBInstances[].DBInstanceIdentifier" --output text)
    if ($rds -and $rds -ne "None") {
        Write-Host "  RDS INSTANCES: $rds" -ForegroundColor Red
        $foundSomething = $true
    }

    # MemoryDB Clusters (Expensive!)
    $mdb = (aws memorydb describe-clusters --region $r --query "Clusters[].Name" --output text 2>$null)
    if ($mdb -and $mdb -ne "None" -and $mdb -ne "[]") {
        Write-Host "  MEMORYDB CLUSTERS: $mdb" -ForegroundColor Red
        $foundSomething = $true
    }

    # Lambda Functions
    $lam = (aws lambda list-functions --region $r --query "Functions[].FunctionName" --output text)
    if ($lam -and $lam -ne "None") {
        Write-Host "  LAMBDA: $lam" -ForegroundColor Red
        $foundSomething = $true
    }

    # DynamoDB Tables
    $ddb = (aws dynamodb list-tables --region $r --query "TableNames" --output text)
    if ($ddb -and $ddb -ne "None" -and $ddb -ne "[]") {
        Write-Host "  DYNAMODB TABLES: $ddb" -ForegroundColor Red
        $foundSomething = $true
    }

    # CloudWatch Log Groups (Storage costs)
    $logs = (aws logs describe-log-groups --region $r --query "logGroups[].logGroupName" --output text)
    if ($logs -and $logs -ne "None") {
        $logCount = ($logs -split "\s+").Count
        Write-Host "  CLOUDWATCH LOG GROUPS: $logCount found" -ForegroundColor Red
        $foundSomething = $true
    }

    # Auto Scaling Groups
    $asg = (aws autoscaling describe-auto-scaling-groups --region $r --query "AutoScalingGroups[].AutoScalingGroupName" --output text)
    if ($asg -and $asg -ne "None") {
        Write-Host "  AUTO SCALING GROUPS: $asg" -ForegroundColor Red
        $foundSomething = $true
    }

    # ECR Repositories (Image storage)
    $ecr = (aws ecr describe-repositories --region $r --query "repositories[].repositoryName" --output text)
    if ($ecr -and $ecr -ne "None") {
        Write-Host "  ECR REPOS: $ecr" -ForegroundColor Red
        $foundSomething = $true
    }

    # AppRunner Services
    $apr = (aws apprunner list-services --region $r --query "ServiceSummaryList[].ServiceName" --output text 2>$null)
    if ($apr -and $apr -ne "None") {
        Write-Host "  APPRUNNER: $apr" -ForegroundColor Red
        $foundSomething = $true
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
if ($foundSomething) {
    Write-Host "  BILLABLE RESOURCES FOUND! See RED lines above." -ForegroundColor Red
    Write-Host "  Copy those lines and paste them here." -ForegroundColor Yellow
} else {
    Write-Host "  NO ACTIVE BILLABLE RESOURCES FOUND." -ForegroundColor Green
    Write-Host "  Your bill is from deleted resources (trailing charges)." -ForegroundColor Yellow
}
Write-Host "========================================" -ForegroundColor Cyan