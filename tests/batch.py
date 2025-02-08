#!/usr/bin/env python3
import matplotlib.pyplot as plt
from matplotlib.widgets import Slider
import numpy as np

# Execution times (in ms)
hack_time    = 1270.5873382302843
weaken_time  = 5082.349352921137
grow_time    = 4065.87948233691
weaken2_time = 5082.349352921137

# Order and durations for operations
op_order = ["hack", "weaken", "grow", "weaken2"]
op_durations = {
    "hack": hack_time,
    "weaken": weaken_time,
    "grow": grow_time,
    "weaken2": weaken2_time
}
op_colors = {
    "hack":    "tab:blue",
    "weaken":  "tab:green",
    "grow":    "tab:orange",
    "weaken2": "tab:red"
}

def white_interval(hack_time, index):
    """
    Returns the white interval (as a tuple (lower, upper)) based on the hack_time and the given index.
    
    For index == 0, the interval is defined as [hack_time, ∞).
    For index >= 1, the interval is [hack_time/(2*index+1), hack_time/(2*index)].
    
    Parameters:
       hack_time: float
           The hack time (H) in ms.
       index: int
           The interval index (0 gives [H, ∞), 1 gives [H/3, H/2], 2 gives [H/5, H/4], etc.)
    
    Returns:
       A tuple (lower_bound, upper_bound). For index 0, upper_bound is float('inf').
    """
    if index == 0:
        return (hack_time, float('inf'))
    else:
        lower_bound = hack_time / (2 * index + 1)
        upper_bound = hack_time / (2 * index)
        return (lower_bound, upper_bound)


def get_bg_color_at(t, delta):
    """
    Given a time t and δ, return the background color at that time
    based on the periodic pattern with period 4·δ:
      - white for t mod (4δ) in [0, δ)
      - red   for t mod (4δ) in [δ, 2δ)
      - white for t mod (4δ) in [2δ, 3δ)
      - red   for t mod (4δ) in [3δ, 4δ)
    """
    period = 4 * delta
    r = t % period
    if delta <= r < 2 * delta or 3 * delta <= r < 4 * delta:
        return "red"
    else:
        return "white"

def draw_background(ax, min_time, max_time, delta):
    """
    Fill the background between min_time and max_time according to the periodic pattern.
    """
    period = 4 * delta
    # Start at the first period boundary at or before min_time.
    t0 = min_time - (min_time % period)
    t = t0
    while t < max_time:
        ax.axvspan(t, t + delta, facecolor="white", alpha=0.3)
        ax.axvspan(t + delta, t + 2*delta, facecolor="red", alpha=0.3)
        ax.axvspan(t + 2*delta, t + 3*delta, facecolor="white", alpha=0.3)
        ax.axvspan(t + 3*delta, t + 4*delta, facecolor="red", alpha=0.3)
        t += period

def draw_batches(ax, delta):
    """
    Draw 5 batches using finish times that are spaced exactly by δ.
    
    For batch i (i = 0,...,4):
      - hack:    finish = (4*i + 1)*δ,   start = finish - hack_time
      - weaken:  finish = (4*i + 2)*δ,   start = finish - weaken_time
      - grow:    finish = (4*i + 3)*δ,   start = finish - grow_time
      - weaken2: finish = (4*i + 4)*δ,   start = finish - weaken2_time
    
    The background is drawn using the periodic pattern.
    """
    ax.clear()
    num_batches = 5
    total_ops = num_batches * len(op_order)
    y_labels = ["" for _ in range(total_ops)]
    
    # Determine overall time span.
    start_times = []
    finish_times = []
    for batch in range(num_batches):
        for op_index, op in enumerate(op_order):
            finish_time = (4 * batch + op_index + 1) * delta
            start_time = finish_time - op_durations[op]
            start_times.append(start_time)
            finish_times.append(finish_time)
    overall_min_time = min(start_times)
    overall_max_time = max(finish_times)
    
    # Draw the periodic background.
    draw_background(ax, overall_min_time, overall_max_time + delta/2, delta)
    
    hacks_in_red = 0   # counter for hack operations with start in red
    grows_in_red = 0   # counter for grow operations with start in red
    
    for batch in range(num_batches):
        for op_index, op in enumerate(op_order):
            overall_index = batch * 4 + op_index
            finish_time = (4 * batch + op_index + 1) * delta
            start_time = finish_time - op_durations[op]
            
            edge_color = 'black'
            line_width = 1
            
            # Check for hack and grow operations.
            if op == "hack":
                bg = get_bg_color_at(start_time, delta)
                if bg == "red":
                    edge_color = 'magenta'
                    line_width = 3
                    hacks_in_red += 1
            elif op == "grow":
                bg = get_bg_color_at(start_time, delta)
                if bg == "red":
                    edge_color = 'cyan'
                    line_width = 3
                    grows_in_red += 1
            
            ax.barh(overall_index, finish_time - start_time, left=start_time,
                    height=0.8, color=op_colors[op], edgecolor=edge_color, linewidth=line_width)
            y_labels[overall_index] = f"B{batch} {op}"
            ax.text(start_time, overall_index, f" B{batch}", va='center', ha='left', fontsize=8, color='black')
    
    # Display both hack and grow counts.
    ax.text(0.98, 0.12, f"Grows in red: {grows_in_red}",
            transform=ax.transAxes, fontsize=12, color='blue', ha='right', va='bottom',
            bbox=dict(facecolor='white', edgecolor='cyan', alpha=0.8))
    ax.text(0.98, 0.02, f"Hacks in red: {hacks_in_red}",
            transform=ax.transAxes, fontsize=12, color='magenta', ha='right', va='bottom',
            bbox=dict(facecolor='white', edgecolor='magenta', alpha=0.8))
    
    ax.set_xlabel("Time (ms)")
    ax.set_title(f"Overlapping Batches Schedule (δ = {delta:.1f} ms)")
    ax.set_yticks(range(total_ops))
    ax.set_yticklabels(y_labels)
    ax.invert_yaxis()
    ax.set_xlim(overall_min_time - delta/2, overall_max_time + delta/2)
    ax.grid(True, axis="x", linestyle="--", alpha=0.5)

def update(val):
    new_delta = slider.val
    draw_batches(ax, new_delta)
    fig.canvas.draw_idle()

def compute_hack_red_intervals():
    """
    Sweep candidate δ values (in ms) from 1 up to hack_time.
    For each candidate δ, evaluate the state of the hack start (for batch 0).
    
    For batch 0, hack finish = δ and hack start = δ - hack_time.
    Using get_bg_color_at, determine if that start falls in red.
    Group contiguous δ values with the same state, and then print the intervals where the state is red.
    """
    H = hack_time
    # We'll sweep integer δ values from 1 to int(H).
    state = None
    intervals = []
    start_val = None
    for d in range(1, int(H) + 1):
        delta_val = float(d)
        # For batch 0 hack: finish = δ, start = δ - hack_time.
        bg = get_bg_color_at(delta_val - H, delta_val)
        if state is None:
            state = bg
            start_val = delta_val
        elif bg != state:
            intervals.append((state, start_val, delta_val - 1))
            state = bg
            start_val = delta_val
    intervals.append((state, start_val, float(int(H))))
    
    print("Intervals (δ in ms) where batch 0 hack start is red:")
    for st, start, end in intervals:
        if st == "red":
            print(f"  Red: [{start:.1f} ms, {end:.1f} ms]")
    print("\nIntervals where batch 0 hack start is white:")
    for st, start, end in intervals:
        if st == "white":
            print(f"  White: [{start:.1f} ms, {end:.1f} ms]")

if __name__ == "__main__":
    # First, print the intervals.
    compute_hack_red_intervals()
    
    # Uncomment the following lines to print white intervals.
    # for i in range(7):
    #     interval = white_interval(hack_time, i)
    #     if i == 0:
    #         print(f"Index {i}: [{interval[0]:.2f} ms, ∞)")
    #     else:
    #         print(f"Index {i}: [{interval[0]:.2f} ms, {interval[1]:.2f} ms]")
    
    # Then set up the interactive visualization.
    fig, ax = plt.subplots(figsize=(12, 6))
    plt.subplots_adjust(bottom=0.25)
    
    init_delta = 100
    draw_batches(ax, init_delta)
    
    ax_slider = plt.axes([0.15, 0.1, 0.7, 0.03])
    slider = Slider(ax_slider, 'δ (ms)', 0, hack_time * 2, valinit=init_delta, valstep=1)
    slider.on_changed(update)
    
    plt.show()
