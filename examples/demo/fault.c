#include "fault.h"

static int fault_count;

void check_fault(int value)
{
    if (value > 0) {
        fault_count++;
    }
}
