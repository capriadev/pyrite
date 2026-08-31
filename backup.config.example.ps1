# backup.config.example.ps1
# Copy this file to backup.config.ps1 (gitignored) and edit the values below.
# backup.ps1 reads this file - do not rename variables, only their values.
#
# Also add this to your package.json "scripts" (once per project):
#   "back": "powershell -ExecutionPolicy Bypass -File ./backup.ps1"
#
# {auto} = placeholder, gets replaced everywhere it appears with the value of
#          ProjectName below (not the folder name - the ProjectName string itself).
#          Use it as many times as you want in any path/name field.

$Config = @{

    ProjectName = "myproject"          # used in backup folder names, e.g. myproject-30-08-2026-b1

    # ============================================================
    # WHAT TO BACK UP (file copy)
    # ============================================================
    ExcludeDirs  = @("node_modules", ".git", "_backups", "dist", "build", ".next", ".turbo")
    ExcludeFiles = @("*.log", "*.tmp")
    OnlyPaths    = @()   # leave empty ( @() ) to back up the whole project

    # ============================================================
    # TARGETS - enable/disable each independently, true/false
    # ============================================================

    # 1) LOCAL - always relative to WHERE THIS SCRIPT RUNS, not to your own PC.
    #
    #    - Running on your dev machine  -> "local" = a folder on your dev machine.
    #    - Running on your home server  -> "local" = a folder ON THAT SERVER'S disk.
    #    In both cases this needs NOTHING extra installed - it's a plain folder copy
    #    (robocopy) on the same machine the script executes on. This should always
    #    stay enabled; it's your fastest, simplest safety net and every other target
    #    is built by copying FROM this staging folder outward.
    #
    #    When you eventually move this project to run ON the server itself:
    #      - LocalPath still just needs to be a real folder on that server (any
    #        internal/secondary disk is fine, doesn't need to be fancy).
    #      - Nothing else changes here - the script doesn't know or care if it's
    #        running on your PC or on a server, it just uses wherever $PSScriptRoot
    #        (the script's own folder) resolves to.
    LocalEnabled = $true
    LocalPath    = "_backups"                # relative to project root, wherever that is

    # Each backup is split into sub-folders instead of one flat dump. This split
    # happens ONLY here, at the local staging stage - External and CloudRemotes
    # copy the whole staged folder as-is, so they inherit this structure for free.
    LocalSystemEnabled   = $true
    LocalSystemSubfolder = "system"    # project files (code) go here
    LocalDbEnabled        = $true
    LocalDbSubfolder      = "docker"   # database dump/volume goes here

    # 2) External drive / other local partition (still same machine, different disk)
    ExternalEnabled = $false
    ExternalPath     = "E:\backups\{auto}"

    # ============================================================
    # CLOUD / REMOTE (via rclone - https://rclone.org)
    # ============================================================
    # Each remote must be already configured once via: rclone config
    # Covers actual cloud (Drive, Dropbox, S3...) AND another PC/server via SFTP -
    # same mechanism either way. Add as many as you want; each runs independently.
    #
    # Setting up a home server (Windows) as a remote? See "HOME SERVER SETUP" below.
    CloudEnabled = $false
    CloudRemotes = @(
        # @{ Name = "gdrive"; Path = "gdrive:Backups/{auto}" }
        # @{ Name = "backblaze"; Path = "b2:my-bucket/{auto}" }
        # @{ Name = "home-server"; Path = "home-server:/C:/backups/{auto}" }   # SFTP = other PC/server, follow HOME SERVER SETUP below
    )

    # ============================================================
    # HOME SERVER SETUP - one-time, done ONCE on the server itself
    # ============================================================
    # 0) On your DEV machine, make sure rclone is installed:
    #      https://rclone.org/downloads/
    #
    # 1) On the SERVER, enable and start an SSH server:
    #      (Windows) Open PowerShell as Administrator and run:
    #        Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
    #        Start-Service sshd
    #        Set-Service -Name sshd -StartupType Automatic
    #      (Linux) Open a terminal and run:
    #        sudo apt install openssh-server
    #        sudo systemctl enable --now ssh
    #
    # 2) On the SERVER, get its local IP (needed for step 3):
    #      (Windows) ipconfig       -> look for "IPv4 Address"
    #      (Linux)   ip addr        -> look for "inet" under your active interface
    #    e.g. 192.168.1.50
    #    (If it's not in the same LAN as your dev machine, see the network notes
    #    above about VPN/DDNS - IP alone won't be reachable then.)
    #
    # 3) On your DEV machine, run:
    #      rclone config
    #    Choose: n (new remote) -> name it EXACTLY "home-server" -> type "sftp"
    #    -> host = the IP from step 2 -> user = your username on the server
    #    -> password or SSH key, your choice.
    #    The name must match step 4 and the CloudRemotes entry above exactly.
    #
    # 4) Test the connection from your DEV machine before trusting it:
    #      rclone lsd home-server:
    #    If it lists folders on the server, you're connected. If it fails here,
    #    fix the SSH/network side first - don't move on to running backups yet.
    #
    # 5) Set CloudEnabled = $true above and uncomment the "home-server" line
    #    in CloudRemotes (already there, matching this exact setup).
    #    Path format differs by target OS:
    #      (Windows) home-server:/C:/backups/{auto}
    #      (Linux)   home-server:/home/youruser/backups/{auto}

    # ============================================================
    # DATABASE (optional - set DbEnabled = $false if no DB in this project)
    # ============================================================
    DbEnabled = $true

    # "dump"   = logical backup via engine-specific tool (see DbEngine below). Portable, human-readable.
    # "volume" = raw tar of the Docker volume. Engine-agnostic - works for ANY database
    #            (Postgres, MySQL, Mongo, Redis, etc.) because it just archives the
    #            files on disk, it doesn't know or care what's inside.
    DbMode = "dump"

    DbEngine    = "postgres"           # only used when DbMode = "dump". Supported: postgres | mysql | mongo
    DbContainer = "{auto}-postgres"
    DbUser      = "user"
    DbName      = "pass"

    DbVolume = "{auto}_postgres-data"  # only used when DbMode = "volume" - check with: docker volume ls
}