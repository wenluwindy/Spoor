//! 硬件探测（0.6.0 自动参数的事实层）。
//!
//! 回答三个问题：有多少内存、多少物理核、GPU 是谁的且**现在**还剩多少显存。
//! 显存分两级精度：
//! - Windows 用 DXGI 枚举适配器拿专用显存总量与**当前预算**（桌面合成器已占的
//!   1GB+ 必须扣掉——这正是老文档里 4GB 卡必 OOM 的坑）；
//! - NVIDIA 再用 `nvidia-smi` 精化（装驱动必有，子进程一问一答，零依赖）。
//! macOS 是统一内存架构，按物理内存的 70% 计"显存"（Metal 的
//! recommendedMaxWorkingSetSize 的常见近似）。
//!
//! 结果缓存一次：显存余量会波动，但自动参数要的是量级不是实时监控；
//! 设置页给「重新检测」按钮走 refresh。

use serde::Serialize;
use std::sync::Mutex;
use sysinfo::System;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub name: String,
    /// 'nvidia' | 'amd' | 'intel' | 'apple' | 'other'
    pub vendor: String,
    pub dedicated_vram_bytes: u64,
    /// 当前还能用的显存（DXGI budget / nvidia-smi free）。拿不到为 None。
    pub available_vram_bytes: Option<u64>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HardwareInfo {
    pub total_ram_bytes: u64,
    pub available_ram_bytes: u64,
    pub physical_cores: u32,
    pub logical_cores: u32,
    /// 按专用显存从大到小排；[0]（如有）就是自动参数选用的那块。
    pub gpus: Vec<GpuInfo>,
    /// 'windows' | 'macos' | 'linux'
    pub platform: String,
    /// macOS 统一内存：gpus 为空但仍可 GPU 推理（Metal 共享内存）。
    pub unified_memory: bool,
}

static CACHE: Mutex<Option<HardwareInfo>> = Mutex::new(None);

fn vendor_from_id(vendor_id: u32) -> &'static str {
    match vendor_id {
        0x10DE => "nvidia",
        0x1002 | 0x1022 => "amd",
        0x8086 => "intel",
        0x106B => "apple",
        _ => "other",
    }
}

/// NVIDIA 精化：`nvidia-smi` 报告的 free 比 DXGI budget 更接近推理可用值。
/// 任何失败都静默返回 None——它只是精化，不是依赖。
fn nvidia_smi_free_bytes() -> Option<u64> {
    let output = std::process::Command::new("nvidia-smi")
        .args(["--query-gpu=memory.free", "--format=csv,noheader,nounits"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mib: u64 = text.lines().next()?.trim().parse().ok()?;
    Some(mib * 1024 * 1024)
}

#[cfg(windows)]
fn probe_gpus() -> Vec<GpuInfo> {
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, IDXGIAdapter3, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE,
        DXGI_MEMORY_SEGMENT_GROUP_LOCAL, DXGI_QUERY_VIDEO_MEMORY_INFO,
    };
    use windows::core::Interface;

    let mut gpus = Vec::new();
    // DXGI 拿不到就拿不到——探测失败退化成"无 GPU 信息"，自动参数落到 CPU 方案
    let factory: IDXGIFactory1 = match unsafe { CreateDXGIFactory1() } {
        Ok(f) => f,
        Err(_) => return gpus,
    };

    let mut index = 0u32;
    while let Ok(adapter) = unsafe { factory.EnumAdapters1(index) } {
        index += 1;
        let Ok(desc) = (unsafe { adapter.GetDesc1() }) else { continue };
        // 软件适配器（WARP）不是显卡
        if (desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32) != 0 {
            continue;
        }
        let name = String::from_utf16_lossy(&desc.Description)
            .trim_end_matches('\0')
            .to_string();
        let dedicated = desc.DedicatedVideoMemory as u64;
        // 集显的专用显存通常只有几十 MB，不值得进列表；阈值 256MB
        if dedicated < 256 * 1024 * 1024 {
            continue;
        }

        // 当前预算：IDXGIAdapter3::QueryVideoMemoryInfo（Win8.1+，Spoor 只支持 Win10/11）
        let mut available = None;
        if let Ok(adapter3) = adapter.cast::<IDXGIAdapter3>() {
            let mut info = DXGI_QUERY_VIDEO_MEMORY_INFO::default();
            if unsafe {
                adapter3.QueryVideoMemoryInfo(0, DXGI_MEMORY_SEGMENT_GROUP_LOCAL, &mut info)
            }
            .is_ok()
            {
                available = Some(info.Budget.saturating_sub(info.CurrentUsage));
            }
        }

        gpus.push(GpuInfo {
            vendor: vendor_from_id(desc.VendorId).to_string(),
            name,
            dedicated_vram_bytes: dedicated,
            available_vram_bytes: available,
        });
    }

    gpus.sort_by(|a, b| b.dedicated_vram_bytes.cmp(&a.dedicated_vram_bytes));
    // NVIDIA 首选卡用 nvidia-smi 精化可用量
    if let Some(first) = gpus.first_mut() {
        if first.vendor == "nvidia" {
            if let Some(free) = nvidia_smi_free_bytes() {
                first.available_vram_bytes = Some(free);
            }
        }
    }
    gpus
}

#[cfg(not(windows))]
fn probe_gpus() -> Vec<GpuInfo> {
    Vec::new()
}

pub fn probe() -> HardwareInfo {
    let mut sys = System::new();
    sys.refresh_memory();
    sys.refresh_cpu_all();

    let logical = std::thread::available_parallelism().map(|n| n.get() as u32).unwrap_or(4);
    // 超线程下开满逻辑核通常更慢；拿不到物理核数就按逻辑核的一半估
    let physical = sys
        .physical_core_count()
        .map(|n| n as u32)
        .unwrap_or_else(|| (logical / 2).max(1));

    HardwareInfo {
        total_ram_bytes: sys.total_memory(),
        available_ram_bytes: sys.available_memory(),
        physical_cores: physical,
        logical_cores: logical,
        gpus: probe_gpus(),
        platform: std::env::consts::OS.to_string(),
        unified_memory: cfg!(target_os = "macos"),
    }
}

#[tauri::command]
pub fn hardware_probe(refresh: Option<bool>) -> HardwareInfo {
    let mut cache = CACHE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if refresh != Some(true) {
        if let Some(cached) = cache.as_ref() {
            return cached.clone();
        }
    }
    let info = probe();
    *cache = Some(info.clone());
    info
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vendor_mapping_covers_the_big_three() {
        assert_eq!(vendor_from_id(0x10DE), "nvidia");
        assert_eq!(vendor_from_id(0x1002), "amd");
        assert_eq!(vendor_from_id(0x8086), "intel");
        assert_eq!(vendor_from_id(0x1234), "other");
    }

    #[test]
    fn probe_reports_sane_cpu_and_memory() {
        let info = probe();
        assert!(info.total_ram_bytes > 0);
        assert!(info.physical_cores >= 1);
        assert!(info.logical_cores >= info.physical_cores);
        assert!(!info.platform.is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn windows_gpus_sorted_by_dedicated_vram() {
        // 真机探测：不断言有卡（CI 可能无独显），有卡时断言排序与厂商归类合法
        let gpus = probe_gpus();
        for pair in gpus.windows(2) {
            assert!(pair[0].dedicated_vram_bytes >= pair[1].dedicated_vram_bytes);
        }
        for gpu in &gpus {
            assert!(["nvidia", "amd", "intel", "apple", "other"].contains(&gpu.vendor.as_str()));
        }
    }
}
