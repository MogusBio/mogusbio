//! Bounded allocator shared by native Core and isolated resource probe.
// The SDK's default allocator hardcodes 32 KiB, even when the transaction
// requests a larger mapped heap. Allocate upward so small 32-KiB instructions
// remain valid, while the synthesis adapter can explicitly request 256 KiB.
// VM mapping still enforces the actual request; insufficient requested heap
// traps atomically rather than giving this allocator access to extra memory.
#[cfg(target_os="solana")]
struct BoundedHeap;
#[cfg(target_os="solana")]
unsafe impl std::alloc::GlobalAlloc for BoundedHeap{
    unsafe fn alloc(&self,layout:std::alloc::Layout)->*mut u8{
        let start=solana_program::entrypoint::HEAP_START_ADDRESS as usize;
        let cursor=start as *mut usize;let previous=*cursor;
        let at=if previous==0{start+std::mem::size_of::<usize>()}else{previous};
        let Some(aligned)=at.checked_add(layout.align()-1).map(|n|n&!(layout.align()-1))else{return std::ptr::null_mut();};
        let Some(end)=aligned.checked_add(layout.size())else{return std::ptr::null_mut();};
        if end>start+256*1024{return std::ptr::null_mut();}*cursor=end;aligned as *mut u8
    }
    unsafe fn dealloc(&self,_:*mut u8,_:std::alloc::Layout){}
}
#[cfg(target_os="solana")]
#[global_allocator]
static HEAP:BoundedHeap=BoundedHeap;

