import math

def get_hack_interval(n, hack_time):
    """
    Return the hack interval for index n:
      H(n) = [hack_time/(2*n+1), hack_time/(2*n)]
    """
    lower = hack_time / (2 * n + 1)
    upper = hack_time / (2 * n)
    return (lower, upper)

def get_grow_interval(m, hack_time):
    """
    Return the grow interval for index m.
    Since grow_time = 3.2 * hack_time, we have:
      G(m) = [3.2*hack_time/(2*m+1), 3.2*hack_time/(2*m)]
    """
    grow_time = 3.2 * hack_time
    lower = grow_time / (2 * m + 1)
    upper = grow_time / (2 * m)
    return (lower, upper)

def intersect_intervals(interval1, interval2):
    """
    Given two intervals (a, b) and (c, d),
    return their intersection [max(a, c), min(b, d)] if nonempty;
    otherwise return None.
    """
    a, b = interval1
    c, d = interval2
    lower = max(a, c)
    upper = min(b, d)
    if lower <= upper:
        return (lower, upper)
    else:
        return None

def get_cropped_intervals(n, hack_time):
    """
    Given a hack interval H(n) for index n, find all grow intervals G(m)
    (with m chosen near 3.2*n) that intersect H(n).

    The method is:
      1. Set candidate m0 = round(3.2*n).
      2. Search downward (decreasing m) until G(m) no longer overlaps H(n).
      3. Search upward (increasing m) until G(m) no longer overlaps H(n).
      4. For each m in the found range, compute the intersection
         I = H(n) ∩ G(m).

    Returns a list of tuples (m, I) where I is the intersection interval.
    """
    # Get the hack interval for n
    H = get_hack_interval(n, hack_time)
    
    # Candidate m from the relation m ~ 3.2 * n.
    candidate_m = max(1, round(3.2 * n))
    
    # Search downward: find the smallest m for which G(m) still overlaps H.
    m_down = candidate_m
    while m_down >= 1:
        G = get_grow_interval(m_down, hack_time)
        if intersect_intervals(H, G) is None:
            break
        m_down -= 1
    m_min = m_down + 1  # last m that gave a nonempty intersection
    
    # Search upward: find the largest m for which G(m) overlaps H.
    m_up = candidate_m + 1
    while True:
        G = get_grow_interval(m_up, hack_time)
        if intersect_intervals(H, G) is None:
            break
        m_up += 1
    m_max = m_up - 1  # last m that worked
    
    # Collect the intersections for m in [m_min, m_max]
    intersections = []
    for m in range(m_min, m_max + 1):
        G = get_grow_interval(m, hack_time)
        inter = intersect_intervals(H, G)
        if inter is not None:
            intersections.append((m, inter))
    return intersections

# --- Example usage ---
hack_time = 1270.5873382302843  # example hack_time value
n = 1  # example hack interval index

H = get_hack_interval(n, hack_time)
print(f"Hack interval for n={n}: {H}")

cropped_intervals = get_cropped_intervals(n, hack_time)
print(f"\nFor hack interval n={n}, the grow intervals that overlap (and their intersections) are:")
for m, inter in cropped_intervals:
    G = get_grow_interval(m, hack_time)
    print(f"  For m={m}:")
    print(f"    Grow interval G({m}) = {G}")
    print(f"    Intersection with H({n}) = {inter}")
