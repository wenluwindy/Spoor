$src = "D:\Tools\llama-cuda"
$dst = "C:\Users\祝融\Desktop\scribe-ai-canvas\binaries"
Remove-Item -Path $dst -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $dst -Force | Out-Null
Get-ChildItem $src | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination "$dst\$($_.Name)" -Force
}
$count = (Get-ChildItem $dst).Count
Write-Host "Copied $count files to $dst"
Get-ChildItem $dst -Filter "*.exe" | Select-Object Name | Format-Table
