import matplotlib.pyplot as plt
import numpy as np

# Extracted data from the log
operations = [
    ("H", 1739043647521, 1739043649065),
    ("W", 1739043643533, 1739043649703),
    ("G", 1739043645434, 1739043650375),
    ("W", 1739043644847, 1739043651019),
    ("H", 1739043650126, 1739043651670),
    ("W", 1739043646146, 1739043652317),
    ("G", 1739043648022, 1739043652960),
    ("W", 1739043647434, 1739043653609),
    ("H", 1739043652699, 1739043654242),
    ("W", 1739043648719, 1739043654889),
    ("W", 1739043650005, 1739043656190),
    ("G", 1739043650598, 1739043656190),
    ("H", 1739043655271, 1739043656818),
    ("W", 1739043651291, 1739043657461),
    ("W", 1739043652577, 1739043658756),
    ("G", 1739043653163, 1739043658756),
    ("H", 1739043657856, 1739043659603),
    ("W", 1739043653887, 1739043660058),
    ("G", 1739043655770, 1739043660707),
    ("W", 1739043655173, 1739043661343),
    ("H", 1739043660455, 1739043662197),
    ("W", 1739043656465, 1739043663460),
    ("G", 1739043658350, 1739043663934),
    ("W", 1739043657751, 1739043664736),
    ("H", 1739043663038, 1739043664796),
    ("W", 1739043659058, 1739043665999),
    ("G", 1739043660937, 1739043667136),
    ("W", 1739043660350, 1739043667277),
    ("H", 1739043665627, 1739043667386),
    ("W", 1739043661652, 1739043668572),
    ("G", 1739043663528, 1739043669055),
    ("W", 1739043662951, 1739043669960),
    ("H", 1739043668228, 1739043670011),
    ("G", 1739043666110, 1739043671629),
    ("W", 1739043664237, 1739043671954),
    ("W", 1739043665528, 1739043672519),
    ("H", 1739043670803, 1739043672563),
    ("W", 1739043666821, 1739043673719),
    ("G", 1739043668711, 1739043674218),
    ("W", 1739043668113, 1739043675092),
    ("H", 1739043673386, 1739043675144)
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
