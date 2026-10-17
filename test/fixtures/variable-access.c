int state;

void reader(void)
{
    consume(state);
}

void writer(void)
{
    state = 1;
    state = 2;
}

void updater(void)
{
    state++;
}

void escape(void)
{
    update(&state);
}

void entry(void)
{
    writer();
}
