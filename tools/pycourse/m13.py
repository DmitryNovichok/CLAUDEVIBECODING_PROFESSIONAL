from _dsl import *  # noqa: F403

ORDER = 13

L1 = level('База: сеть и её адреса', 'ipaddress: ip_network(…, 0), адрес сети, широковещательный, перебор адресов, двоичная запись', [
    title('Задание 13', 'IP-адреса и маски: модуль ipaddress делает всю двоичную арифметику за нас',
          chips=['ip_network', "f'{ip:b}'", 'net[0], net[-1]', 'маска /n']),
    code('Сеть по адресу и маске', '''
        from ipaddress import ip_network
        net = ip_network('192.168.32.48/255.255.255.240', 0)
        print(net)
        print(net.network_address, net.broadcast_address, net.netmask)
        print(net.num_addresses, net[0], net[-1], net[1])
    ''', cond=p('ip_network(\'адрес/маска\', 0) — сеть, в которую входит адрес. Второй аргумент 0 (strict=False) обязателен: '
                'иначе Python ругается, что адрес узла — не адрес сети.',
                'net[0] — адрес сети, net[-1] — широковещательный адрес. Узлам их назначать нельзя.'),
         note='Маску можно писать и числом единиц: /28 — то же, что 255.255.255.240.', k='Уровень 1'),
    code('Двоичная запись адреса', '''
        from ipaddress import ip_address
        ip = ip_address('172.16.160.7')
        b = f'{ip:b}'
        print(b, len(b), b.count('1'))
        print(bin(160)[2:].zfill(8))
    ''', cond=p("f'{ip:b}' — все 32 бита адреса одной строкой, с ведущими нулями. Дальше — обычные методы строк."), k='Уровень 1'),
    code('Перебор адресов сети', '''
        from ipaddress import ip_network
        net = ip_network('172.16.160.0/255.255.240.0', 0)
        k = 0
        for ip in net:
            if f'{ip:b}'.count('1') % 2 == 0:
                k += 1
        print(k)
    ''', cond=p('for ip in net перебирает все адреса сети, включая адрес сети и широковещательный. Нужны только узлы — net.hosts().'),
         k='Уровень 1'),
], [
    task('even1', 'Чётное число единиц',
         p('Сеть задана IP-адресом 172.16.160.0 и маской 255.255.240.0. Сколько в этой сети адресов, в двоичной записи которых чётное число единиц?'),
         '''
from ipaddress import ip_network
net = ip_network('172.16.160.0/255.255.240.0', 0)
print(sum(1 for ip in net if f'{ip:b}'.count('1') % 2 == 0))'''),
    task('netaddr', 'Адрес сети',
         p('Узел имеет IP-адрес 205.99.68.249, маска сети 255.255.248.0. Найдите адрес сети. Ответ запишите в обычном виде, например 10.0.0.0.'),
         '''
from ipaddress import ip_network
print(ip_network('205.99.68.249/255.255.248.0', 0).network_address)'''),
    task('lastnode', 'Последний узел',
         p('Узел с IP-адресом 73.148.145.65 находится в сети с маской 255.224.0.0. Найдите наибольший IP-адрес, который может быть назначен узлу этой сети. '
           'В ответе запишите сумму четырёх чисел этого адреса.'),
         '''
from ipaddress import ip_network
net = ip_network('73.148.145.65/255.224.0.0', 0)
ip = net[-2]
print(sum(int(x) for x in str(ip).split('.')))''', hint='Наибольший адрес узла — предпоследний: net[-2]. Последний (широковещательный) узлу не дают.'),
    task('odd1', 'Нечётное число единиц',
         p('Сеть задана адресом 172.16.80.0 и маской 255.255.248.0. Сколько адресов этой сети содержат нечётное число единиц в двоичной записи?'),
         '''
from ipaddress import ip_network
net = ip_network('172.16.80.0/255.255.248.0', 0)
print(sum(1 for ip in net if f'{ip:b}'.count('1') % 2 == 1))'''),
    task('not7', 'Не кратно 7',
         p('Сеть задана адресом 203.68.128.0 и маской 255.255.192.0. Сколько адресов сети, у которых количество единиц в двоичной записи не делится на 7?'),
         '''
from ipaddress import ip_network
net = ip_network('203.68.128.0/255.255.192.0', 0)
print(sum(1 for ip in net if f'{ip:b}'.count('1') % 7 != 0))'''),
])

L2 = level('Стандарт: неизвестная маска', 'перебор масок от /0 до /32: адрес в сети, адрес сети совпал, байт маски', [
    code('Перебор масок', '''
        from ipaddress import ip_address, ip_network
        ip = ip_address('84.23.84.23')
        for m in range(33):
            net = ip_network(f'{ip}/{m}', 0)
            if net.network_address == ip_address('84.23.84.0'):
                print(m, net.netmask)
    ''', cond=p('Маска неизвестна — перебираем все 33 варианта /0 … /32 и оставляем подходящие по условию.'),
         note='Адрес узла не может совпадать с адресом сети и широковещательным: для узла проверяйте net[0] &lt; ip &lt; net[-1].', nk='warn',
         k='Уровень 2'),
    code('Два узла в одной сети', '''
        from ipaddress import ip_address, ip_network
        a = ip_address('157.220.185.237')
        b = ip_address('157.220.184.230')
        for m in range(32, -1, -1):
            if b in ip_network(f'{a}/{m}', 0):
                print('наибольшая маска:', m)
                break
    ''', cond=p('«ip in net» — входит ли адрес в сеть. Чем больше единиц в маске, тем меньше сеть: идём от /32 вниз и берём первую, где оба адреса вместе.'),
         k='Уровень 2'),
    code('Байт маски', '''
        from ipaddress import ip_network
        net = ip_network('200.154.190.7/21', 0)
        print(net.netmask, str(net.netmask).split('.')[2])
    ''', cond=p('Третий слева байт маски — третье число в записи netmask.'), k='Уровень 2'),
], [
    task('maxones', 'Наибольшее число единиц',
         p('Для узла с IP-адресом 84.23.84.23 адрес сети равен 84.23.84.0. Чему равно наибольшее возможное количество единиц в маске?'),
         '''
from ipaddress import ip_address, ip_network
ip = ip_address('84.23.84.23')
best = None
for m in range(33):
    net = ip_network(f'{ip}/{m}', 0)
    if net.network_address == ip_address('84.23.84.0') and net[0] < ip < net[-1]:
        best = m
print(best)'''),
    task('byte3', 'Третий байт маски',
         p('Для узла с IP-адресом 215.181.200.27 адрес сети равен 215.181.192.0. Чему равен третий слева байт маски, если известно, что в сети '
           'наибольшее возможное количество адресов?'),
         '''
from ipaddress import ip_address, ip_network
ip = ip_address('215.181.200.27')
for m in range(33):
    net = ip_network(f'{ip}/{m}', 0)
    if net.network_address == ip_address('215.181.192.0'):
        print(str(net.netmask).split('.')[2])
        break''', hint='Больше адресов — меньше единиц в маске: перебирайте маски с /0 вверх и берите первую подходящую.'),
    task('count15', 'Сеть для двух узлов',
         p('Узлы 157.220.185.237 и 157.220.184.230 находятся в одной сети, и маска этой сети наибольшая из возможных. '
           'Сколько адресов этой сети содержат ровно 15 единиц в двоичной записи?'),
         '''
from ipaddress import ip_address, ip_network
a, b = ip_address('157.220.185.237'), ip_address('157.220.184.230')
for m in range(32, -1, -1):
    net = ip_network(f'{a}/{m}', 0)
    if b in net:
        break
print(sum(1 for ip in net if f'{ip:b}'.count('1') == 15))'''),
    task('nmasks', 'Сколько масок',
         p('Узел с IP-адресом 111.81.88.168. Сколько существует различных масок, при которых этот адрес можно назначить узлу '
           '(он не совпадает ни с адресом сети, ни с широковещательным)?'),
         '''
from ipaddress import ip_address, ip_network
ip = ip_address('111.81.88.168')
k = 0
for m in range(33):
    net = ip_network(f'{ip}/{m}', 0)
    if net[0] < ip < net[-1]:
        k += 1
print(k)'''),
    task('same', 'Одна маска на двоих',
         p('Узлы 134.181.67.112 и 134.181.94.117 находятся в одной сети. Какое наибольшее количество единиц может быть в маске этой сети, '
           'если ни один из адресов не является адресом сети или широковещательным?'),
         '''
from ipaddress import ip_address, ip_network
a, b = ip_address('134.181.67.112'), ip_address('134.181.94.117')
best = None
for m in range(33):
    net = ip_network(f'{a}/{m}', 0)
    if b in net and net[0] < a < net[-1] and net[0] < b < net[-1]:
        best = m
print(best)'''),
])

L3 = level('Профи: условия на биты', 'половины адреса, равенство нулей и единиц, только узлы, последний подходящий адрес', [
    code('Левая и правая половины', '''
        from ipaddress import ip_address
        b = f"{ip_address('253.112.169.12'):b}"
        left, right = b[:16], b[16:]
        print(left.count('1'), right.count('1'))
    ''', cond=p('32-битная строка режется срезами: [:16] — два левых байта, [16:] — два правых, [8:16] — второй байт.'), k='Уровень 3'),
    code('Только узлы', '''
        from ipaddress import ip_network
        net = ip_network('10.0.0.0/29', 0)
        print([str(ip) for ip in net.hosts()])
        print(net.num_addresses - 2)
    ''', cond=p('hosts() — адреса без адреса сети и широковещательного. Количество узлов — num_addresses − 2.'),
         note='Срез net[1:-1] у сети не работает (ошибка TypeError) — пользуйтесь hosts() или индексами net[i].', nk='warn', k='Уровень 3'),
], [
    task('halves', 'Справа не меньше',
         p('Сеть задана адресом 253.112.169.12 и маской 255.255.254.0. Сколько адресов сети, у которых в двух правых байтах единиц не меньше, '
           'чем в двух левых?'),
         '''
from ipaddress import ip_network
net = ip_network('253.112.169.12/255.255.254.0', 0)
k = 0
for ip in net:
    b = f'{ip:b}'
    if b[16:].count('1') >= b[:16].count('1'):
        k += 1
print(k)'''),
    task('equal', 'Нулей и единиц поровну',
         p('Сеть задана адресом 192.168.12.207 и маской 255.255.192.0. Среди адресов узлов сети (кроме адреса сети и широковещательного) найдите '
           'последний адрес, у которого нулей и единиц в двоичной записи поровну. Ответ — адрес в обычном виде.'),
         '''
from ipaddress import ip_network
net = ip_network('192.168.12.207/255.255.192.0', 0)
last = None
for ip in net.hosts():
    b = f'{ip:b}'
    if b.count('1') == b.count('0'):
        last = ip
print(last)''', hint='«Последний» — запоминайте найденный адрес в переменной и печатайте после цикла.', stars=2),
    task('byte2', 'Второй байт',
         p('Сеть задана адресом 115.200.0.0 и маской 255.255.0.0. Сколько адресов сети, у которых количество единиц в двоичной записи второго слева '
           'байта больше количества единиц в третьем байте?'),
         '''
from ipaddress import ip_network
net = ip_network('115.200.0.0/255.255.0.0', 0)
k = 0
for ip in net:
    b = f'{ip:b}'
    if b[8:16].count('1') > b[16:24].count('1'):
        k += 1
print(k)''', stars=2),
    task('ends', 'Оканчивается на 0',
         p('Сеть задана адресом 172.16.192.0 и маской 255.255.192.0. Сколько адресов узлов, двоичная запись которых оканчивается '
           'на 0 и содержит число единиц, не кратное 5?'),
         '''
from ipaddress import ip_network
net = ip_network('172.16.192.0/255.255.192.0', 0)
k = 0
for ip in net.hosts():
    b = f'{ip:b}'
    if b.endswith('0') and b.count('1') % 5 != 0:
        k += 1
print(k)'''),
])

L4 = level('Максимум: перебор сетей', 'неизвестная маска + условия на адреса сети, сравнение адресов, количества', [
    code('Сеть, в которой есть нужные адреса', '''
        from ipaddress import ip_address, ip_network
        ip = ip_address('76.172.10.140')
        for m in range(33):
            net = ip_network(f'{ip}/{m}', 0)
            cnt = sum(1 for x in net if f'{x:b}'.count('1') % 2 == 0) if net.num_addresses <= 1 << 12 else None
            if cnt is not None and cnt >= 100:
                print(m, cnt)
    ''', cond=p('Условие может касаться всей сети: «в сети не меньше 100 адресов с чётным числом единиц». Перебираем маски и для каждой считаем.'),
         note='Маленькие маски — гигантские сети (миллионы адресов). Отсекайте их заранее, иначе перебор будет очень долгим.', nk='warn',
         k='Уровень 4'),
    code('Адреса можно сравнивать и складывать с числами', '''
        from ipaddress import ip_address
        a = ip_address('10.0.0.255')
        print(a + 1, a > ip_address('10.0.0.7'), int(a))
    ''', cond=p('IP-адрес — это 32-битное число. int(ip) — его значение, ip + 1 — следующий адрес.'), k='Уровень 4'),
], [
    task('min100', 'Хватит ли адресов',
         p('Узел имеет адрес 76.172.10.140. Найдите наибольшее количество единиц в маске, при котором в сети этого узла не меньше 100 адресов '
           'с чётным числом единиц в двоичной записи.'),
         '''
from ipaddress import ip_address, ip_network
ip = ip_address('76.172.10.140')
best = None
for m in range(33):
    net = ip_network(f'{ip}/{m}', 0)
    if net.num_addresses > 1 << 16:
        continue
    if sum(1 for x in net if f'{x:b}'.count('1') % 2 == 0) >= 100:
        best = m
print(best)''', stars=2),
    task('between', 'Между двумя адресами',
         p('Сколько IP-адресов строго между 10.27.255.200 и 10.28.1.17 содержат в двоичной записи ровно 19 единиц?'),
         '''
from ipaddress import ip_address
a, b = int(ip_address('10.27.255.200')), int(ip_address('10.28.1.17'))
print(sum(1 for x in range(a + 1, b) if bin(x).count('1') == 19))''', hint='Адреса — числа: int(ip_address(...)). Дальше обычный range.', stars=2),
    task('netcount', 'Сколько сетей',
         p('Для скольких масок (от /0 до /32) адрес 192.168.217.38 можно назначить узлу, а в сети при этом не больше 1000 адресов?'),
         '''
from ipaddress import ip_address, ip_network
ip = ip_address('192.168.217.38')
k = 0
for m in range(33):
    net = ip_network(f'{ip}/{m}', 0)
    if net[0] < ip < net[-1] and net.num_addresses <= 1000:
        k += 1
print(k)'''),
    task('third', 'Третий байт по двум условиям',
         p('Узел с адресом 140.116.195.120 находится в сети, в которой адрес 140.116.200.1 тоже является адресом узла, '
           'а адрес 140.116.224.5 — не входит. Найдите количество возможных масок.'),
         '''
from ipaddress import ip_address, ip_network
a = ip_address('140.116.195.120')
b, c = ip_address('140.116.200.1'), ip_address('140.116.224.5')
k = 0
for m in range(33):
    net = ip_network(f'{a}/{m}', 0)
    if b in net and net[0] < b < net[-1] and net[0] < a < net[-1] and c not in net:
        k += 1
print(k)''', stars=3),
])

MODULE = module('m13', 'IP-адреса и маски', '🌐', 'ipaddress: сети и узлы, неизвестные маски, условия на двоичную запись',
                [L1, L2, L3, L4], n=13)
