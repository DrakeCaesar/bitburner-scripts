// Global operator new/delete routed through the pool allocator. The profiling
// build defines its own counting overrides in profiler.cpp (on top of the same
// pool), so these are compiled out there.
//
// Not on Apple platforms: a replacement here only sees the allocations whose
// call sites were compiled into this binary. libc++.dylib runs the rest - its
// non-template code allocates and frees through its own malloc-backed new/delete,
// and dyld's two-level namespace keeps those calls bound to the dylib, so the two
// allocators cross. A malloc'd block then reaches release() and is freed 16 bytes
// off, and a pool block reaches free() from libc++'s thread-exit cleanup; libmalloc
// aborts on both. The pool itself is still usable explicitly; only the global hooks
// are skipped.
#include "fast_alloc.hpp"

#if !defined(IPVGO_PROFILER) && !defined(__APPLE__)

void* operator new(size_t size) { return ipvgo::fastalloc::allocate(size); }
void* operator new[](size_t size) { return ipvgo::fastalloc::allocate(size); }
void operator delete(void* p) noexcept { ipvgo::fastalloc::release(p); }
void operator delete[](void* p) noexcept { ipvgo::fastalloc::release(p); }
void operator delete(void* p, size_t) noexcept { ipvgo::fastalloc::release(p); }
void operator delete[](void* p, size_t) noexcept { ipvgo::fastalloc::release(p); }

#endif
