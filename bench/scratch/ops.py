import matplotlib.pyplot as plt
import numpy as np

# Extracted data from the log
operations = [
    ("H", 1739062605984, 1739062612737),
    ("W", 1739062607055, 1739062613188),
    ("G", 1739062608131, 1739062614438),
    ("W", 1739062609205, 1739062615342),
    ("H", 1739062610281, 1739062617027),
    ("W", 1739062611358, 1739062617497),
    ("G", 1739062612441, 1739062618746),
    ("W", 1739062613514, 1739062619647),
    ("H", 1739062614581, 1739062621524),
    ("W", 1739062615653, 1739062621788),
    ("G", 1739062616730, 1739062623038),
    ("W", 1739062617803, 1739062623946),
    ("H", 1739062618871, 1739062625821),
    ("W", 1739062619944, 1739062626083),
    ("G", 1739062621025, 1739062627329),
    ("W", 1739062622098, 1739062628236),
]

# Assigning colors
op_colors = {"H": "red", "W": "blue", "G": "green"}

# Sort operations by end time first
operations_sorted = sorted(operations, key=lambda x: x[2])

# Reorder operations to follow HWGW pattern
reordered_ops = []
seen_h = [op for op in operations_sorted if op[0] == "H"]
seen_w = [op for op in operations_sorted if op[0] == "W"]
seen_g = [op for op in operations_sorted if op[0] == "G"]

while seen_h or seen_w or seen_g:
    if seen_h:
        reordered_ops.append(seen_h.pop(0))
    if seen_w:
        reordered_ops.append(seen_w.pop(0))
    if seen_g:
        reordered_ops.append(seen_g.pop(0))
    if seen_w:
        reordered_ops.append(seen_w.pop(0))

# Convert timestamps to a relative scale (start at zero)
min_time = min(start for _, start, _ in reordered_ops)
reordered_ops_relative = [(op, start - min_time, end - min_time) for op, start, end in reordered_ops]

# Create a figure with two subplots
fig, axs = plt.subplots(2, 1, figsize=(12, 12))

# Plot the operations timeline (we plot in reverse order so that the most recent is at the top)
for i, (op, start, end) in enumerate(reversed(reordered_ops_relative)):
    # Only add a label the first time each op type appears
    if op not in [op_ for op_, _, _ in reordered_ops_relative[:len(reordered_ops_relative)-i-1]]:
        label = op
    else:
        label = ""
    axs[0].barh(i, end - start, left=start, color=op_colors[op], label=label)

# Labels and formatting for timeline
axs[0].set_xlabel("Time (relative)")
axs[0].set_ylabel("Operations")
axs[0].set_title("Hacking Operations Timeline (Ordered)")
axs[0].legend()

# Extract durations for each operation type in the HWGW order
h_durations = [end - start for op, start, end in reordered_ops if op == "H"]
w_durations = [end - start for op, start, end in reordered_ops if op == "W"]
g_durations = [end - start for op, start, end in reordered_ops if op == "G"]

# Create indices for x-axis (using the order in reordered_ops)
h_indices = [i for i, op in enumerate(reordered_ops) if op[0] == "H"]
w_indices = [i for i, op in enumerate(reordered_ops) if op[0] == "W"]
g_indices = [i for i, op in enumerate(reordered_ops) if op[0] == "G"]

# Plot the durations over time
axs[1].plot(h_indices, h_durations, marker='o', linestyle='-', color='red', label="Hack (H) Duration")
axs[1].plot(w_indices, w_durations, marker='o', linestyle='-', color='blue', label="Weaken (W) Duration")
axs[1].plot(g_indices, g_durations, marker='o', linestyle='-', color='green', label="Grow (G) Duration")

# Labels and formatting for durations
axs[1].set_xlabel("Operation Index")
axs[1].set_ylabel("Duration (ms)")
axs[1].set_title("Operation Duration Over Time")
axs[1].legend()

# ----
# Additional marking: for every hack (H) or grow (G) op, find the op (if any)
# that finished immediately before it started. If that op was also H or G, then mark
# the hack/grow op (the "op(1)") with a bright yellow dot at the start of its bar.
# ----

n_ops = len(reordered_ops_relative)
# Note: In the timeline plot, the vertical coordinate for the op at index j
# (in reordered_ops_relative) is: y = n_ops - 1 - j (because of the reverse ordering)
for j, (op_type, start, end) in enumerate(reordered_ops_relative):
    if op_type in ("H", "G"):
        # Find among all other ops the one with the highest end time that is still less than 'start'
        candidate_end = -np.inf
        candidate = None
        for k, (ot, s, e) in enumerate(reordered_ops_relative):
            if k == j:
                continue
            if e < start and e > candidate_end:
                candidate_end = e
                candidate = (ot, s, e)
        # If we found a candidate op and its type is also H or G, mark the current op with a yellow dot.
        if candidate is not None and candidate[0] in ("H", "G"):
            y_coord = n_ops - 1 - j  # matching the vertical location in the barh plot
            axs[0].plot(start, y_coord, marker='o', markersize=10, color='purple', linestyle='None')

# Adjust layout and show plot
plt.tight_layout()
plt.show()
