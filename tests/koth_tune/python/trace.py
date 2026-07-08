import math
from koth_gen import (generate_assignments, altitude, true_layout, gaussian_width,
                      numeric_range, DEFAULT_SEED, DEFAULT_DIFFICULTY)
from solver import solve, Session, _find_crest, _walk_to_main, _pinpoint

pw = "9038143964"
diff = 60
L = len(pw)
lo, hi = numeric_range(L)
w = gaussian_width(L)
lay = true_layout(pw, diff)
print("p=", pw, "lo=", lo, "hi=", hi, "w=", w)
print("pw_hill_index=", lay["pw_hill_index"])
for h in lay["hills"]:
    print(f"  hill i={h['i']} center={h['center']:.1f} height={h['height']:.1f}  (offset_w={(h['center']-int(pw))/w:+.2f})")
print("cluster spans:", min(h['center'] for h in lay['hills']), "->", max(h['center'] for h in lay['hills']))
print("near-zone half-width in w:", 0.03*int(pw)/w)

# manual grid
span = hi - lo
print("\ngrid:")
for k in range(7):
    x = round(lo + span*k/6)
    print(f"  k={k} x={x} alt={altitude(pw,diff,x):.3f}")

res = solve({"password": pw, "difficulty": diff, "passwordLength": L})
print("\nresult:", res)
