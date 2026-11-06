#!/usr/bin/env bash
# deploy.yml's `app_services` / `rollback_services`: the services each app-stack `up` names.
# A profile only makes a service eligible, so staging and demo must name mailpit (Epic 87 test
# inbox), prod must not, and the rollback (previous compose file, maybe without mailpit) drops it.
# Prod also names `site` (school websites, Epic 40); its rollback drops it for the same reason.
# No root, no Docker: the expressions are read out of deploy.yml and rendered by ansible itself.
# Needs ansible-playbook. Run: bash app-services.infra.test.sh
set -u
here=$(cd "$(dirname "$0")" && pwd)
command -v ansible-playbook >/dev/null || { echo "skip: ansible-playbook not installed"; exit 0; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fails=0

# The play vars come out as raw template text; copied to .j2 files, the template lookup renders
# them (the same on ansible-core 2.18 and later).
cat > "$work/play.yml" <<EOF
- hosts: localhost
  connection: local
  gather_facts: false
  become: false
  tasks:
    - ansible.builtin.set_fact:
        deploy_vars: "{{ (lookup('ansible.builtin.file', '$here/../deploy.yml') | from_yaml)[0].vars }}"
    - ansible.builtin.copy:
        dest: '$work/app.j2'
        content: '{{ deploy_vars.app_services }}'
      check_mode: false
    - ansible.builtin.copy:
        dest: '$work/rollback.j2'
        content: '{{ deploy_vars.rollback_services }}'
      check_mode: false
    - ansible.builtin.debug:
        msg: "APP=[{{ lookup('ansible.builtin.template', '$work/app.j2') | trim }}]"
    - ansible.builtin.debug:
        msg: "ROLLBACK=[{{ lookup('ansible.builtin.template', '$work/rollback.j2', template_vars={'app_services': lookup('ansible.builtin.template', '$work/app.j2') | trim}) | trim }}]"
EOF

# \$1 stack, \$2 db_users_before
run() {
  ansible-playbook -c local -i localhost, "$work/play.yml" -e "stack=$1" -e "db_users_before=$2" > "$work/out.txt" 2>&1 \
    || { echo "FAIL ansible-playbook failed for $1"; cat "$work/out.txt"; fails=$((fails + 1)); }
}
want() { # <label> <regex>
  if grep -qE -- "$2" "$work/out.txt"; then echo "ok   $1"; else echo "FAIL $1 (wanted /$2/)"; fails=$((fails + 1)); fi
}

for stack in staging demo; do
  run "$stack" 1
  want "$stack names mailpit" "APP=\[db redis seaweedfs mailpit app\]"
  want "$stack rollback leaves mailpit out" "ROLLBACK=\[db redis seaweedfs app\]"
done

run prod 1
want "prod never names mailpit, names site" "APP=\[db redis seaweedfs app app2 site backup\]"
want "prod rollback leaves site out (old compose file may predate it)" "ROLLBACK=\[db redis seaweedfs app app2 backup\]"
run prod 0
want "fresh prod holds backup back" "APP=\[db redis seaweedfs app app2 site\]"

[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
