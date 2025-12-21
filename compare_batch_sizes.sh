#!/bin/bash
echo "=== Batch Size Performance Comparison ==="
echo ""
if [ -f batch_performance_10.txt ]; then
    echo "📊 Batch Size 10:"
    cat batch_performance_10.txt
    echo ""
fi
if [ -f batch_performance_20.txt ]; then
    echo "📊 Batch Size 20:"
    cat batch_performance_20.txt
    echo ""
    echo "=== Comparison ==="
    TIME_10=$(grep "Total Time:" batch_performance_10.txt | awk '{print $3}' | sed 's/s//')
    TIME_20=$(grep "Total Time:" batch_performance_20.txt | awk '{print $3}' | sed 's/s//')
    if [ ! -z "$TIME_10" ] && [ ! -z "$TIME_20" ]; then
        DIFF=$(echo "$TIME_10 - $TIME_20" | bc)
        PCT=$(echo "scale=1; ($DIFF / $TIME_10) * 100" | bc)
        echo "Time difference: ${DIFF}s (${PCT}% change)"
        if (( $(echo "$TIME_20 < $TIME_10" | bc -l) )); then
            echo "✅ Batch size 20 is FASTER"
        else
            echo "⚠️  Batch size 20 is SLOWER"
        fi
    fi
else
    echo "⏳ Waiting for batch size 20 results..."
fi
