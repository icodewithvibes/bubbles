#!/usr/bin/env bash
# Builds src/kit/stickers.json: curated meme stickers from Tenor's sticker search
# (transparent .webp, the same CDN the GIF library uses). Re-run to refresh.
set -euo pipefail
cd "$(dirname "$0")/.."
BAD='nsfw|sex|porn|nude|naked|boob|tits|butt|dick|penis|cock|pussy|fuck|shit|bitch|slut|whore|drug|weed|blunt|vape|gun|kill|suicide|blood|gore|hitler|nazi|racist|thirst|onlyfans|twerk|hump|schwing|seductive|turned-on|lick|gay|hornet'
declare -A ICON=( ["Cursed Emoji"]="🫠" ["Reactions"]="😳" ["SpongeBob"]="🧽" ["Cats"]="🐱" ["Dogs"]="🐶" ["Critters"]="🦝" ["Cursed"]="👁️" ["Sigma & Rizz"]="🗿" ["Funny Text"]="💬" ["Dancing"]="🕺" ["Love"]="💖" ["Sad"]="😭" )
ORDER=("Cursed Emoji" "Reactions" "Cursed" "Critters" "SpongeBob" "Cats" "Dogs" "Sigma & Rizz" "Funny Text" "Dancing" "Love" "Sad")
declare -A TERMS=(
  ["Cursed Emoji"]="cursed-emoji emoji-meme side-eye-emoji blushing-emoji-meme"
  ["Reactions"]="meme-face reaction-meme bruh skull-meme"
  ["SpongeBob"]="spongebob-meme patrick-meme"
  ["Cats"]="cat-meme silly-cat"
  ["Dogs"]="dog-meme funny-dog"
  ["Critters"]="lemur-meme possum raccoon-meme monkey-meme hamster-meme capybara"
  ["Cursed"]="cursed creepy-doll cursed-image"
  ["Sigma & Rizz"]="sigma rizz gigachad chill-guy"
  ["Funny Text"]="anti-horny bonk no-thoughts cringe"
  ["Dancing"]="dancing-meme"
  ["Love"]="love-meme kiss-meme hug-meme"
  ["Sad"]="crying-meme sad-meme"
)
declare -A CAP=( ["Critters"]=60 ["Cursed Emoji"]=54 ["Reactions"]=54 ["Sigma & Rizz"]=42 ["Funny Text"]=40 )
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'
out='['
first=1
for cat in "${ORDER[@]}"; do
  list=$(for t in ${TERMS[$cat]}; do
      curl -sL -A "$UA" "https://tenor.com/search/${t}-gifs?format=stickers" \
        | grep -oE 'media\.tenor\.com/[A-Za-z0-9_-]+AAAAm/[a-z0-9-]+\.webp' || true
      sleep 0.3
    done | sed -E 's#media\.tenor\.com/##; s#\.webp$##' | awk '!seen[$0]++' | grep -viE "/[^/]*(${BAD})" | head -n "${CAP[$cat]:-36}")
  json=$(printf '%s\n' "$list" | sed '/^$/d' | sed 's/.*/"&"/' | paste -sd, -)
  [ $first -eq 1 ] || out+=','
  first=0
  out+="{\"icon\":\"${ICON[$cat]}\",\"name\":\"${cat}\",\"stickers\":[${json}]}"
  echo "$cat: $(printf '%s\n' "$list" | sed '/^$/d' | wc -l)" >&2
done
out+=']'
printf '%s\n' "$out" > src/kit/stickers.json
