# Given operation runtimes
hack_time    = 1270.5873382302843
weaken_time  = 5082.349352921137
grow_time    = 4065.87948233691
weaken2_time = 5082.349352921137  # same as weaken_time

# Compute optimal batch delay (here approximately 529.41)
batch_delay = (hack_time / 2 + hack_time / 3) / 2  # ≈ 529.41

# Set the baseline finish time as the finish of weaken1.
baseline_finish = weaken_time

print(f"Batch Delay: {batch_delay:.2f}\n")
print("Simplified schedule (equal finish intervals):\n")

num_batches = 3
for k in range(num_batches):
    # Compute the offset for the current batch.
    offset = k * 4 * batch_delay

    # Target finish times for the operations:
    finish_hack    = baseline_finish + offset - batch_delay
    finish_weaken1 = baseline_finish + offset           # anchored at weaken_time
    finish_grow    = baseline_finish + offset + batch_delay
    finish_weaken2 = baseline_finish + offset + 2 * batch_delay

    # Sleep times (delay before starting each operation):
    sleep_hack    = finish_hack    - hack_time
    sleep_weaken1 = finish_weaken1 - weaken_time  # equals offset
    sleep_grow    = finish_grow    - grow_time
    sleep_weaken2 = finish_weaken2 - weaken2_time  # equals offset + 2*batch_delay

    print(f"Batch {k}:")
    print(f"  Sleep Hack:    {sleep_hack:.2f}  -> Finish Hack:    {finish_hack:.2f}")
    print(f"  Sleep Weaken1: {sleep_weaken1:.2f}  -> Finish Weaken1: {finish_weaken1:.2f}")
    print(f"  Sleep Grow:    {sleep_grow:.2f}  -> Finish Grow:    {finish_grow:.2f}")
    print(f"  Sleep Weaken2: {sleep_weaken2:.2f}  -> Finish Weaken2: {finish_weaken2:.2f}")
    print("  Intervals (Hack->Weaken1, Weaken1->Grow, Grow->Weaken2):")
    print(f"    {finish_weaken1 - finish_hack:.2f}, {finish_grow - finish_weaken1:.2f}, {finish_weaken2 - finish_grow:.2f}")
    print("-" * 50)
