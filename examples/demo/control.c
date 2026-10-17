#include "fault.h"

void (*fault_handlers[])(int) = { check_fault };

void control_task(void)
{
    check_fault(1);
    check_fault(2);
}

void background_task(void)
{
#if 0
    check_fault(99); /* disabled: hidden by default */
#else
    check_fault(3);
#endif
}

#if BOARD_PRO
void optional_task(void) { check_fault(4); }
#endif

int main(void)
{
    control_task();
    background_task();
    return 0;
}
