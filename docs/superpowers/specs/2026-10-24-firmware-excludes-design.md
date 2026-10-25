# Firmware default exclusions

Goal: reduce tool-generated C/H analysis noise without broadly excluding runtime firmware sources. This extends the existing editable defaults; explicit user Exclude lists continue to replace defaults, and `[]` disables configurable exclusions.

Alternatives considered:

- Recommended: recognizable tool/output directory names. Covers common output layouts with a small configuration-only change.
- Broad exclusions such as Debug, Release, generated, MDK-ARM, EWARM, SDK, HAL, BSP and RTOS: rejected because those folders can contain required source, startup code or generated production headers.
- Build-system-driven discovery: potentially more precise, but requires a separate feature and is outside this change.

Add Polyspace prefix variants (`polyspace`, `Polyspace`, `PolySpace`, `POLYSPACE`) including artifact/result suffixes. Add Obj/obj, Objects/objects, Listings/listings, BrowseInfo and C-STAT. Restrict generic List and Exe names to descendants of EWARM. PlatformIO's `.pio/build` is already covered by `**/build/**`; preserve `.pio/libdeps` dependency sources.

Also exclude Unity, CMock/CMocka and CppUTest framework directories, since these can live outside test directories. Preserve Drivers, Middlewares, FreeRTOS, CMSIS, HAL and BSP as potential runtime source and supporting definition providers.

Sources:

- https://www.mathworks.com/help/bugfinder/ug/artifacts-and-results-generated-by-polyspace-platform-projects.html
- https://www.keil.com/support/man/docs/uv4cl/uv4cl_ca_spec_seprte_fldr.htm
- https://docs.iar.com/ewarm/9.7x/en/ide-project-management-and-building/product-files/project-directory-structure.html
- https://docs.platformio.org/en/latest/projectconf/sections/platformio/options/directory/build_dir.html
- https://www.throwtheswitch.org/
- https://cpputest.github.io/

Implementation and verification: update package.json defaults and settings text, align README/USER_GUIDE, check root/nested path matches and preserved firmware source paths, then run existing scope-picker tests and diff checks. These are overridable naming conventions, not proof that every matching file is disposable. Users whose runtime sources share these names can remove the relevant configurable rule.
