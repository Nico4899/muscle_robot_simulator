#!/usr/bin/env bash
# Release scrub (spec 04): run in make check and before every push. Lists the tracked files and
# fails on anything that must not be published; prints every hit for a human to look at.
#   paths:   media files, private/, reference/, .claude/, .env
#   content: email addresses, /Users/ and /home/ paths, key-like tokens, and the words
#            seeding, cells requested, rings requested, milestone (the lab's plan stays private)
# This file itself is not content-grepped: it holds the patterns.
set -uo pipefail
cd "$(dirname "$0")/.."

hits=0
hit() { echo "HIT   $1"; hits=$((hits + 1)); }

files=$(git ls-files)
n_files=$(printf '%s\n' "$files" | grep -c .)

while IFS= read -r f; do
  [ -n "$f" ] && hit "forbidden path tracked: $f"
done < <(printf '%s\n' "$files" | grep -E '^(private|reference|\.claude)/|(^|/)\.env($|\.)')

while IFS= read -r f; do
  [ -n "$f" ] && hit "media file tracked: $f"
done < <(printf '%s\n' "$files" \
  | grep -iE '\.(mp4|mov|m4v|avi|mkv|webm|png|jpe?g|gif|tiff?|heic|webp|bmp)$')

grep_hits() {  # $1: label, $2: extended regex, $3: extra git grep flags
  while IFS= read -r line; do
    [ -n "$line" ] && hit "$1: $line"
  done < <(git grep -n -I ${3:-} -E "$2" -- . ':!scripts/scrub.sh')
}
grep_hits "email" '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}'
grep_hits "home path" '/Users/|/home/'
grep_hits "key-like token" \
  'sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----'
grep_hits "secret assignment" '(api[_-]?key|secret|passw(or)?d|token)["'"'"' ]*[:=][ ]*["'"'"'][^"'"'"']{8,}' -i
grep_hits "private word" 'seeding|cells requested|rings requested|milestone' -i

if [ "$hits" -eq 0 ]; then
  echo "scrub: ok, $n_files tracked files, 0 hits"
else
  echo "scrub: $hits hits in $n_files tracked files (printed above): FAIL"
  exit 1
fi
