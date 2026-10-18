# Deployment (Linux server)

```bash
npm run install:all && npm run build
cp .env.example .env     # set COOKIE_SECURE=1 behind HTTPS; ALLOW_REGISTRATION=0 to close sign-ups
npm start                # serves API + built web app on PORT, under /finance-tracker/
```

## Ansible (recommended)

The whole server is described in `deploy/ansible/` (Ubuntu 24.04+, SSH key access as a sudo user).

```bash
cd deploy/ansible
ansible-galaxy collection install -r requirements.yml   # once
ansible-playbook site.yml                 # full setup: packages, hardening, app, HTTPS
ansible-playbook site.yml --tags app      # deploy code changes only (rebuild + restart)
ansible-playbook site.yml --check --diff  # preview changes without applying
```

Settings (port, open sign-ups, backups, nginx snippets of other apps on the same domain) live in `deploy/ansible/group_vars/finance/vars.yml`.

| Role | Does |
|------|------|
| `base` | full upgrade, Node/nginx/certbot/fail2ban, automatic security updates (reboot 04:30 if needed) |
| `hardening` | SSH key-only, no root, `AllowUsers`; ufw (22 rate-limited, 80, 443); fail2ban; sysctl |
| `app` | `finance` system user, code in root-owned `/opt/finance`, data in `/var/lib/finance`, sandboxed systemd unit, daily backup 03:15 (kept 30 days) |
| `web` | Let's Encrypt certificate (auto-renew), nginx HTTPS proxy, security headers (CSP, HSTS), rate limits on login/register |

The CSP hash for the inline theme script in `web/index.html` is computed from each build, so editing that script needs no manual step.

Server address, SSH user and domain are encrypted with Ansible Vault in `group_vars/finance/vault.yml`.
That file is not in the repository (it's in `.gitignore`). To deploy your own server, copy `vault.example.yml`
to `group_vars/finance/vault.yml` with your values and run `ansible-vault encrypt` (see the comments in the file).
The password is read from `~/.config/ansible/finance-vault-pass` (never commit it).
Edit later with `ansible-vault edit group_vars/finance/vault.yml`.
