// Global operator new/delete routed through the pool allocator. The profiling
// build defines its own counting overrides in profiler.cpp (on top of the same
// pool), so these are compiled out there.
#ifndef IPVGO_PROFILER

#include "fast_alloc.hpp"

void* operator new(size_t size) { return ipvgo::fastalloc::allocate(size); }
void* operator new[](size_t size) { return ipvgo::fastalloc::allocate(size); }
void operator delete(void* p) noexcept { ipvgo::fastalloc::release(p); }
void operator delete[](void* p) noexcept { ipvgo::fastalloc::release(p); }
void operator delete(void* p, size_t) noexcept { ipvgo::fastalloc::release(p); }
void operator delete[](void* p, size_t) noexcept { ipvgo::fastalloc::release(p); }

#endif
