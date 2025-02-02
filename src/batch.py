# This script takes four times (hack_time, weaken_time, grow_time, weaken2_time)
# and dynamically finds a delta that satisfies the batching constraints.

# Execution times for Hack, Weaken, and Grow (in ms)
hack_time = 1270.5873382302843
weaken_time = 5082.349352921137
grow_time = 4065.87948233691
weaken2_time = weaken_time  # Weaken2 is identical to Weaken1

# Define parameters for delta search
delta_step = 10  # Step size for delta in ms
max_delta = 2000  # Maximum delta to test in ms

# Validate function
def validate_batches(delta, num_batches=20):
    hack_start_times = []  # Track all Hack start times
    current_time = 0

    for batch_index in range(num_batches):
        # Define the start and finish times for each action in the batch
        weaken1_start = current_time
        weaken1_finish = weaken1_start + weaken_time

        grow_start = weaken1_finish + delta
        grow_finish = grow_start + grow_time

        weaken2_start = grow_finish + delta
        weaken2_finish = weaken2_start + weaken2_time

        # Find the valid interval for Hack: After Weaken1 or Weaken2, but before another Hack or Weaken finishes
        valid_hack_start = max(weaken1_finish, weaken2_finish)
        valid_hack_end = min(grow_start, weaken2_finish)

        # Dynamically adjust delta to ensure Hack starts in the middle of the interval
        hack_start = (valid_hack_start + valid_hack_end) / 2
        hack_finish = hack_start + hack_time

        # Store Hack start time for comparison
        hack_start_times.append(hack_start)

        # Determine the last operation to finish before Hack starts
        possible_finish_times = [("Weaken1", weaken1_finish), ("Weaken2", weaken2_finish)]
        closest_op_time = max(
            (op for op in possible_finish_times if op[1] <= hack_start),
            key=lambda x: x[1],
            default=(None, None)
        )
        last_op_label, last_op_time = closest_op_time
        time_since_last = hack_start - last_op_time if last_op_time else None
        print(f"Batch {batch_index + 1}: Last Weaken to finish before Hack: {last_op_label}, Time since last: {time_since_last:.2f} ms, Hack Start: {hack_start:.2f} ms")

        # Move to the next batch
        current_time += 4 * delta

    # Validate Hack start times against the flipping windows (delta * 2)
    for i in range(1, len(hack_start_times)):
        allowed_start = hack_start_times[i - 1] + (2 * delta)
        if hack_start_times[i] < allowed_start:
            return False

    return True

# Search for the optimal delta
optimal_delta = None
for delta in range(delta_step, max_delta + delta_step, delta_step):
    if validate_batches(delta):
        optimal_delta = delta
        break

if optimal_delta is not None:
    print(f"Optimal delta found: {optimal_delta} ms")
else:
    print("No valid delta found within the tested range.")
