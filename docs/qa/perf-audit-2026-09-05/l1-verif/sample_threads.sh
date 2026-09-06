end=$(( $(date +%s) + 240 ))
while [ $(date +%s) -lt $end ]; do
  echo "T $(date +%s)"
  for p in /proc/[0-9]*; do
    pid=${p#/proc/}
    cmd=$(tr '\0' ' ' < $p/cmdline 2>/dev/null | cut -c1-80)
    case "$cmd" in *python*|*nest-engine*|*nest_engine*)
      for t in $p/task/*; do
        s=$(cat $t/stat 2>/dev/null) || continue
        echo "$pid ${t##*/} $(echo "$s" | awk '{print $14, $15}') | $cmd"
      done;;
    esac
  done
  sleep 2
done
