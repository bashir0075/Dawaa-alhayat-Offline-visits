#!/bin/sh
# ════════════════════════════════════════════════════════════════
#  نسخ احتياطي ليلي لقاعدة بيانات الزيارات
#  يُحتفظ بـ 30 نسخة يومية · 12 نسخة شهرية
# ════════════════════════════════════════════════════════════════
set -eu

HOST="${POSTGRES_HOST:-postgres}"
USER="${POSTGRES_USER:-visits_app}"
DB="${POSTGRES_DB:-visits}"
DIR="/backups"
STAMP="$(date +%Y-%m-%d_%H%M)"
DAY_OF_MONTH="$(date +%d)"

mkdir -p "$DIR/daily" "$DIR/monthly"

FILE="$DIR/daily/visits_${STAMP}.sql.gz"

echo "[$(date)] بدء النسخ الاحتياطي → $FILE"

pg_dump -h "$HOST" -U "$USER" -d "$DB" --no-owner --no-acl \
  | gzip -9 > "$FILE.tmp"

# لا نعتمد نسخة ناقصة: نعيد التسمية فقط بعد نجاح pg_dump كاملاً
mv "$FILE.tmp" "$FILE"

SIZE="$(du -h "$FILE" | cut -f1)"
echo "[$(date)] ✅ اكتمل — $SIZE"

# نسخة شهرية في أول يوم من الشهر
if [ "$DAY_OF_MONTH" = "01" ]; then
  cp "$FILE" "$DIR/monthly/visits_$(date +%Y-%m).sql.gz"
  echo "[$(date)] 📦 حُفظت نسخة شهرية"
fi

# تنظيف: 30 يوماً · 12 شهراً
find "$DIR/daily"   -name 'visits_*.sql.gz' -mtime +30  -delete
find "$DIR/monthly" -name 'visits_*.sql.gz' -mtime +366 -delete

# تحذير إن كان حجم النسخة صغيراً بشكل مريب (قاعدة فارغة أو خطأ)
BYTES="$(stat -c %s "$FILE" 2>/dev/null || echo 0)"
if [ "$BYTES" -lt 10240 ]; then
  echo "[$(date)] ⚠️  تحذير: حجم النسخة $BYTES بايت فقط — تحقّق من قاعدة البيانات"
  exit 1
fi

echo "[$(date)] عدد النسخ اليومية المحفوظة: $(ls -1 "$DIR/daily" | wc -l)"
